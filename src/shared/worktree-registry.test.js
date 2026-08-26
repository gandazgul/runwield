import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { listPlans, savePlan } from "../plan-store.js";
import {
    addEntry,
    findById,
    findByPlanId,
    findByPlanName,
    getWorktreeRegistryPath,
    listEntries,
    pruneStaleEntries,
    removeEntry,
    updateEntry,
    WorktreeRegistryAmbiguityError,
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
        const refusal = await assertRejects(
            () =>
                addEntry(
                    projectRoot,
                    entry({ id: "second", planId: "plan-1", branch: "runwield/worktree/demo-plan-wt-2" }),
                ),
            WorktreeRegistryAmbiguityError,
        );
        // The write refusal is correct, but a refusal the user cannot act on strands
        // them: it has to name the colliding attempts and a command that resolves them.
        assertStringIncludes(refusal.message, "more than one unfinished worktree attempt");
        assertStringIncludes(refusal.message, "first");
        assertEquals(refusal.kind, "duplicate_live_attempt");
        assertEquals(refusal.entryIds.includes("first"), true);
        assertEquals(
            refusal.recoveryActions.some((action) => action.command?.includes("plans doctor")),
            true,
            "a refusal must carry a copy-ready command",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("a damaged attempt for one Plan does not disable every other Plan", async () => {
    // One hand-edited or badly-merged registry used to make *every* worktree command
    // in the project fail with a bare invariant message — including the commands that
    // diagnose and repair it. Reads are permissive now, so the damage stays scoped to
    // the question that genuinely cannot be answered.
    const projectRoot = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            getWorktreeRegistryPath(projectRoot),
            JSON.stringify({
                version: 2,
                entries: [
                    entry({ id: "dup-a", planName: "broken", planId: "plan-broken" }),
                    entry({
                        id: "dup-b",
                        planName: "broken",
                        planId: "plan-broken",
                        branch: "runwield/worktree/broken-b",
                    }),
                    entry({ id: "healthy", planName: "healthy", planId: "plan-healthy" }),
                ],
            }),
        );

        const listed = await listEntries(projectRoot, { migrate: false });
        assertEquals(listed.length, 3, "listing damaged data is how the user sees the damage");

        const healthy = await findByPlanId(projectRoot, "plan-healthy");
        assertEquals(healthy?.id, "healthy", "an unrelated Plan keeps working");
        assertEquals((await findById(projectRoot, "dup-a"))?.id, "dup-a", "an exact attempt id is unambiguous");

        const ambiguous = await assertRejects(
            () => findByPlanId(projectRoot, "plan-broken"),
            WorktreeRegistryAmbiguityError,
        );
        assertStringIncludes(ambiguous.message, "dup-a");
        assertStringIncludes(ambiguous.message, "dup-b");
        assertStringIncludes(ambiguous.message, "Nothing has been changed or deleted");
        assertEquals(ambiguous.planName, "broken");
        assertEquals(
            ambiguous.recoveryActions.some((action) => action.command?.includes("load-plan broken")),
            true,
            "the Plan-scoped recovery route must be offered by name",
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

        const failure = await assertRejects(() => listEntries(projectRoot), WorktreeRegistryAmbiguityError);
        assertStringIncludes(failure.message, "appears more than once");
        assertEquals(failure.kind, "duplicate_worktree_id");
        assertEquals(
            failure.recoveryActions.some((action) => action.command?.includes("plans doctor")),
            true,
        );
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
        await Deno.writeTextFile(
            path,
            JSON.stringify({
                version: 1,
                entries: [entry({ planId: undefined, path: join(projectRoot, "missing-attempt") })],
            }),
        );
        const primaryPath = join(projectRoot, "docs/plans/demo-plan.md");
        const beforePlan = await Deno.readTextFile(primaryPath);
        await assertRejects(() => listPlans(projectRoot), Error, "execution Plan is missing");

        const entries = await listEntries(projectRoot);
        assertEquals(entries[0].planId, "plan-1");
        const stored = JSON.parse(await Deno.readTextFile(path));
        assertEquals(stored.version, 2);
        assertEquals(await Deno.readTextFile(primaryPath), beforePlan);
        await assertRejects(() => listPlans(projectRoot), Error, "execution Plan is missing");
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

Deno.test("registry migration keeps distinct execution documents ambiguous", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-registry-evidence-" });
    try {
        const firstPath = join(projectRoot, "first");
        const secondPath = join(projectRoot, "second");
        for (const root of [projectRoot, firstPath, secondPath]) {
            await savePlan(root, "demo-plan", "# Same Plan identity\n", {
                planId: "plan-1",
                status: "in_progress",
                classification: "FEATURE",
            });
        }
        const path = getWorktreeRegistryPath(projectRoot);
        await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            path,
            JSON.stringify({
                version: 1,
                entries: [
                    entry({ id: "first", planId: undefined, path: firstPath }),
                    entry({ id: "second", planId: undefined, path: secondPath, branch: "runwield/worktree/second" }),
                ],
            }),
        );
        const entries = await listEntries(projectRoot);
        assertEquals(entries.map((attempt) => attempt.planId), [undefined, undefined]);
        const issues = JSON.parse(
            await Deno.readTextFile(join(projectRoot, ".wld/worktree-registry-migration-issues.json")),
        );
        assertEquals(issues.issues.map((/** @type {{ reason: string }} */ issue) => issue.reason), [
            "ambiguous_plan_name",
            "ambiguous_plan_name",
        ]);
        for (const root of [firstPath, secondPath]) {
            const document = join(root, "docs/plans/demo-plan.md");
            await Deno.writeTextFile(
                document,
                (await Deno.readTextFile(document)).replace("---\n", "---\nworktreeId: first\n"),
            );
        }
        const conflictingPointers = await listEntries(projectRoot);
        assertEquals(conflictingPointers.map((attempt) => attempt.planId), [undefined, undefined]);
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
