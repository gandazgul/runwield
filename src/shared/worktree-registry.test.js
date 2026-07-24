import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    addEntry,
    findById,
    findByPlanName,
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
        assertEquals((await findByPlanName(projectRoot, "demo-plan"))?.id, "wt-1");
        assertEquals((await findById(projectRoot, "wt-1"))?.branch, "runwield/worktree/demo-plan-wt-1");

        const updated = await updateEntry(projectRoot, "wt-1", { status: "completed" });
        assertEquals(updated?.status, "completed");

        await removeEntry(projectRoot, "wt-1");
        assertEquals(await listEntries(projectRoot), []);
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

Deno.test("worktree registry prunes entries whose paths are missing", async () => {
    const projectRoot = await Deno.makeTempDir();
    try {
        const existingPath = join(projectRoot, "existing-worktree");
        await Deno.mkdir(existingPath);
        await addEntry(projectRoot, entry({ id: "existing", path: existingPath }));
        await addEntry(projectRoot, entry({ id: "missing", path: join(projectRoot, "missing-worktree") }));

        const stale = await pruneStaleEntries(projectRoot);
        assertEquals(stale.map((item) => item.id), ["missing"]);
        assertEquals((await listEntries(projectRoot)).map((item) => item.id), ["existing"]);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
