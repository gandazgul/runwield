import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { savePlan } from "../plan-store.js";
import {
    addEntry,
    findById,
    findByPlanName,
    getWorktreeRegistryPath,
    listEntries,
    pruneStaleEntries,
    removeEntry,
    updateEntry,
} from "./worktree-registry.js";

/**
 * @param {Partial<import('./worktree-registry.js').WorktreeRegistryEntry>} [overrides]
 * @returns {import('./worktree-registry.js').WorktreeRegistryEntry}
 */
function entry(overrides = {}) {
    return {
        id: "wt-1",
        planName: "demo-plan",
        planId: "plan-demo",
        baseBranch: "main",
        baseRef: "HEAD",
        baseCommit: "abc123",
        branch: "runwield/worktree/demo-plan-wt-1",
        path: "/tmp/demo-plan-wt-1",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

Deno.test("worktree registry supports add/update/find/list/remove", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await addEntry(projectRoot, entry());
        assertEquals((await listEntries(projectRoot)).length, 1);
        assertEquals(await findByPlanName(projectRoot, "demo-plan"), null);
        assertEquals((await findById(projectRoot, "wt-1"))?.branch, "runwield/worktree/demo-plan-wt-1");

        const updated = await updateEntry(projectRoot, "wt-1", { status: "completed" });
        assertEquals(updated?.status, "completed");

        await removeEntry(projectRoot, "wt-1");
        const retained = await listEntries(projectRoot);
        assertEquals(retained.length, 1);
        assertEquals(retained[0].id, "wt-1");
        assertEquals(retained[0].status, "abandoned");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry rejects immutable identity updates", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await addEntry(projectRoot, entry({ baseTree: "tree-1" }));
        for (
            const updates of [
                { baseBranch: "other" },
                { baseRef: "refs/heads/main" },
                { baseCommit: "def456" },
                { baseTree: "tree-2" },
                { branch: "runwield/worktree/other" },
            ]
        ) {
            await assertRejects(
                () => updateEntry(projectRoot, "wt-1", /** @type {any} */ (updates)),
                Error,
                "Worktree registry identity field cannot be updated",
            );
        }
        assertEquals(await findById(projectRoot, "wt-1"), entry({ baseTree: "tree-1" }));
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry rejects duplicate nonterminal attempts", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await addEntry(projectRoot, entry({ id: "first", planId: "plan-1" }));
        await assertRejects(
            () =>
                addEntry(
                    projectRoot,
                    entry({ id: "second", planId: "plan-1", branch: "runwield/worktree/demo-plan-wt-2" }),
                ),
            Error,
            "nonterminal attempt",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry throws on missing-id update", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await assertRejects(() => updateEntry(projectRoot, "missing", { status: "completed" }), Error, "not found");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry rejects duplicate durable ids on read", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        const path = getWorktreeRegistryPath(projectRoot);
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            path,
            JSON.stringify({
                version: 2,
                entries: [entry({ id: "same" }), entry({ id: "same", branch: "runwield/worktree/other" })],
            }),
        );

        await assertRejects(() => listEntries(projectRoot), Error, "Duplicate worktree registry id: same");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry rejects duplicate live legacy plan-name attempts", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await assertRejects(
            () => addEntry(projectRoot, entry({ id: "legacy-1", planId: undefined })),
            Error,
            "requires a stable planId",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry prunes entries whose paths are missing", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        const existingPath = join(projectRoot, "existing-worktree");
        await Deno.mkdir(existingPath);
        await addEntry(projectRoot, entry({ id: "existing", path: existingPath }));
        await addEntry(
            projectRoot,
            entry({
                id: "missing",
                planName: "missing-plan",
                planId: "plan-missing",
                branch: "runwield/worktree/missing-plan-wt-1",
                path: join(projectRoot, "missing-worktree"),
            }),
        );

        const stale = await pruneStaleEntries(projectRoot);
        assertEquals(stale.map((item) => item.id), ["missing"]);
        assertEquals((await listEntries(projectRoot)).map((item) => [item.id, item.status]), [
            ["existing", "active"],
            ["missing", "active"],
        ]);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry migration resolves unambiguous legacy plan names", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "demo-plan", "# Demo", {
            planId: "plan-1",
            status: "in_progress",
            classification: "FEATURE",
        });
        const path = getWorktreeRegistryPath(projectRoot);
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(path, JSON.stringify({ version: 1, entries: [entry({ planId: undefined })] }));

        const entries = await listEntries(projectRoot);
        assertEquals(entries[0].planId, "plan-1");
        const stored = JSON.parse(await Deno.readTextFile(path));
        assertEquals(stored.version, 2);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry migration classifies duplicate live legacy attempts for recovery", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        const path = getWorktreeRegistryPath(projectRoot);
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            path,
            JSON.stringify({
                version: 1,
                entries: [
                    entry({ id: "legacy-1", planName: "missing-plan", planId: undefined }),
                    entry({
                        id: "legacy-2",
                        planName: "missing-plan",
                        planId: undefined,
                        branch: "runwield/worktree/missing-plan-wt-2",
                    }),
                ],
            }),
        );

        const entries = await listEntries(projectRoot);
        assertEquals(entries.map((item) => item.id), ["legacy-1", "legacy-2"]);
        const stored = JSON.parse(await Deno.readTextFile(path));
        assertEquals(stored.version, 1);
        const issues = JSON.parse(
            await Deno.readTextFile(join(projectRoot, ".wld", "worktree-registry-migration-issues.json")),
        );
        assertEquals(issues.issues.map((/** @type {{ id: string }} */ issue) => issue.id), ["legacy-1", "legacy-2"]);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("worktree registry migration preserves unresolved legacy schema and records evidence", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        const path = getWorktreeRegistryPath(projectRoot);
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            path,
            JSON.stringify({ version: 1, entries: [entry({ planName: "missing-plan", planId: undefined })] }),
        );

        const entries = await listEntries(projectRoot);
        assertEquals(entries[0].planId, undefined);
        const stored = JSON.parse(await Deno.readTextFile(path));
        assertEquals(stored.version, 1);
        const issues = JSON.parse(
            await Deno.readTextFile(join(projectRoot, ".wld", "worktree-registry-migration-issues.json")),
        );
        assertEquals(issues.issues[0].reason, "plan_not_found_or_missing_plan_id");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
