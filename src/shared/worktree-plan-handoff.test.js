import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { loadPlan, savePlan } from "../plan-store.js";

/** @param {number} ms */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * macOS can briefly report recursive temp cleanup as ENOTEMPTY/EBUSY while
 * filesystem metadata settles after Git worktree operations. Retry boundedly so
 * cleanup flakiness does not fail an otherwise successful handoff test.
 *
 * @param {string} path
 */
async function removeTempDir(path) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await Deno.remove(path, { recursive: true });
            return;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            const isRetryable = error instanceof Error &&
                /Directory not empty|resource busy|os error 66|os error 16/i.test(error.message);
            if (!isRetryable || attempt === 4) throw error;
            await delay(25 * (attempt + 1));
        }
    }
}

/**
 * @param {string} cwd
 * @param {string} planName
 * @param {string} content
 * @param {import('../plan-store.js').PlanFrontMatterInput} attrs
 */
async function savePlanForTest(cwd, planName, content, attrs) {
    const existing = await loadPlan(cwd, planName).catch(() => null);
    return await savePlan(cwd, planName, content, attrs, existing ? { expectedRevision: existing.revision } : {});
}

import { stageValidationPassedInExecutionWorktree } from "./workflow/plan-lifecycle.js";

import {
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeWorktreeGitArtifacts,
    restorePrimaryPlanPathAfterMergeFailure,
} from "./worktree.js";

import { createTestWorktreeAttempt, git, makeRepo, TEST_DELIVERY_DETAILS } from "./worktree-test-helpers.js";

Deno.test("primary Plan path handoff restores tracked and untracked working files", async () => {
    const projectRoot = await makeRepo();
    try {
        await Deno.mkdir(`${projectRoot}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(`${projectRoot}/docs/plans/tracked.md`, "checked in\n");
        await git(projectRoot, ["add", "docs/plans/tracked.md"]);
        await git(projectRoot, ["commit", "-m", "add plan"]);
        await Deno.writeTextFile(`${projectRoot}/docs/plans/tracked.md`, "staged implemented\n");
        await git(projectRoot, ["add", "docs/plans/tracked.md"]);
        await Deno.writeTextFile(`${projectRoot}/docs/plans/tracked.md`, "unstaged implemented\n");
        await Deno.writeTextFile(`${projectRoot}/docs/plans/untracked.md`, "untracked implemented\n");

        const tracked = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "docs/plans/tracked.md",
        });
        const untracked = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "docs/plans/untracked.md",
        });
        assertEquals(await Deno.readTextFile(`${projectRoot}/docs/plans/tracked.md`), "checked in\n");
        assertEquals(await git(projectRoot, ["diff", "--cached", "--", "docs/plans/tracked.md"]), "");
        await assertRejects(() => Deno.stat(`${projectRoot}/docs/plans/untracked.md`), Deno.errors.NotFound);

        await restorePrimaryPlanPathAfterMergeFailure(tracked);
        await restorePrimaryPlanPathAfterMergeFailure(untracked);
        assertEquals(await Deno.readTextFile(`${projectRoot}/docs/plans/tracked.md`), "unstaged implemented\n");
        assertEquals(await git(projectRoot, ["show", ":docs/plans/tracked.md"]), "staged implemented");
        assertStringIncludes(await git(projectRoot, ["status", "--short", "--", "docs/plans/tracked.md"]), "MM");
        assertEquals(await Deno.readTextFile(`${projectRoot}/docs/plans/untracked.md`), "untracked implemented\n");
    } finally {
        await removeTempDir(projectRoot);
    }
});

Deno.test("verified Plan metadata merges with execution changes without dirtying primary checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await savePlanForTest(projectRoot, "feature", "# Feature", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "docs/plans/feature.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add feature plan"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Feature",
            worktreeRoot,
        });
        await savePlanForTest(projectRoot, "feature", "# Feature", {
            status: "implemented",
            implementedAt: "2026-01-01T00:00:00.000Z",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "validated\n");

        await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "feature",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-01-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "docs/plans/feature.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: ["docs/plans/feature.md"],
            planName: "feature",
        });

        assertEquals((await loadPlan(projectRoot, "feature"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "feature"))?.attrs.verifiedAt, "2026-01-02T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "validated\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});

Deno.test("verified Plan metadata conflicts are resolved during worktree merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await savePlanForTest(projectRoot, "verified-conflict", "# Verified Conflict", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "docs/plans/verified-conflict.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add verified conflict plan"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Verified Conflict",
            worktreeRoot,
        });

        await savePlanForTest(projectRoot, "verified-conflict", "# Verified Conflict", {
            status: "implemented",
            implementedAt: "2026-04-01T00:00:00.000Z",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await git(projectRoot, ["add", "docs/plans/verified-conflict.md"]);
        await git(projectRoot, ["commit", "-m", "record implemented plan state"]);
        await Deno.writeTextFile(`${worktree.path}/verified-conflict.txt`, "validated\n");

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "verified-conflict",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-04-02T00:00:00.000Z") },
        });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            planName: "verified-conflict",
        });

        const plan = await loadPlan(projectRoot, "verified-conflict");
        assertEquals(plan?.attrs.status, "verified");
        assertEquals(plan?.attrs.verifiedAt, "2026-04-02T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/verified-conflict.txt`), "validated\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});

Deno.test("verified child merge ignores independently active sibling Plan metadata", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlanForTest(
            projectRoot,
            "epic",
            "# Epic",
            /** @type {any} */ ({
                status: "ready_for_work",
                classification: "PROJECT",
            }),
        );
        for (const name of ["child-a", "child-b"]) {
            await savePlanForTest(projectRoot, name, `# ${name}`, {
                status: "ready_for_work",
                classification: "FEATURE",
                parentPlan: "epic",
            });
        }
        await git(projectRoot, ["add", "docs/plans", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add concurrent children"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Child A",
            worktreeRoot,
        });

        await savePlanForTest(projectRoot, "child-a", "# child-a", {
            status: "implemented",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });
        await savePlanForTest(projectRoot, "child-b", "# child-b", {
            status: "in_progress",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: "runwield/worktree/child-b-active",
        });

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "child-a",
            details: TEST_DELIVERY_DETAILS,
        });
        assertEquals(staged.planPaths, ["docs/plans/child-a.md"]);
        assertEquals((await loadPlan(worktree.path, "child-b"))?.attrs.status, "ready_for_work");
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "docs/plans/child-a.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            allowedDirtyPaths: ["docs/plans/child-a.md"],
            planName: "child-a",
        });

        assertEquals((await loadPlan(projectRoot, "child-a"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "child-b"))?.attrs.status, "in_progress");
        assertStringIncludes(await git(projectRoot, ["status", "--porcelain", "docs/plans/child-b.md"]), "child-b.md");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});

Deno.test("parent Epic verification survives stale-worktree target alignment", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        const epicAttrs = /** @type {any} */ ({
            status: "ready_for_work",
            classification: "PROJECT",
        });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlanForTest(projectRoot, "epic", "# Epic", epicAttrs);
        await savePlanForTest(projectRoot, "child-a", "# A", {
            status: "ready_for_work",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await savePlanForTest(projectRoot, "child-b", "# B", {
            status: "ready_for_work",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await git(projectRoot, ["add", "docs/plans", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add epic hierarchy"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Child B",
            worktreeRoot,
        });

        await savePlanForTest(projectRoot, "child-a", "# A", {
            status: "verified",
            classification: "FEATURE",
            ...TEST_DELIVERY_DETAILS,
            parentPlan: "epic",
        });
        await git(projectRoot, ["add", "docs/plans/child-a.md"]);
        await git(projectRoot, ["commit", "-m", "verify first child"]);
        await savePlanForTest(projectRoot, "child-b", "# B", {
            status: "implemented",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "child-b",
            details: TEST_DELIVERY_DETAILS,
        });
        for (const relativePath of staged.planPaths) {
            await preparePrimaryPlanPathForMerge({ projectRoot, relativePath });
        }
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            planName: "child-b",
        });

        assertEquals((await loadPlan(projectRoot, "child-b"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.status, "verified");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});

Deno.test("verified Plan survives index rollback before continuing a conflicted merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await savePlanForTest(projectRoot, "conflicted-retry", "# Conflicted Retry", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "docs/plans/conflicted-retry.md", "conflict.txt", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add conflicted retry plan"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Conflicted Retry",
            worktreeRoot,
        });
        const activeWorktree = worktree;

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlanForTest(projectRoot, "conflicted-retry", "# Conflicted Retry", {
            status: "implemented",
            worktreeBranch: activeWorktree.branch,
            worktreePath: activeWorktree.path,
        });
        await Deno.writeTextFile(`${activeWorktree.path}/conflict.txt`, "execution\n");
        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: activeWorktree.path,
            planName: "conflicted-retry",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-03-01T00:00:00.000Z") },
        });
        const firstSnapshot = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "docs/plans/conflicted-retry.md",
        });

        await assertRejects(() =>
            mergeExecutionWorktree({
                projectRoot,
                branch: activeWorktree.branch,
                targetBranch: "main",
                worktreePath: activeWorktree.path,
                preservePlanPaths: staged.planPaths,
                planName: "conflicted-retry",
            })
        );
        await restorePrimaryPlanPathAfterMergeFailure(firstSnapshot);
        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.status, "implemented");

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        const retried = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: activeWorktree.path,
            planName: "conflicted-retry",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-03-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "docs/plans/conflicted-retry.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: activeWorktree.branch,
            targetBranch: "main",
            worktreePath: activeWorktree.path,
            preservePlanPaths: retried.planPaths,
            planName: "conflicted-retry",
        });

        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.verifiedAt, "2026-03-01T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/conflict.txt`), "resolved\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});

Deno.test("verified Plan handoff rolls back exactly and retries with stable metadata", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlanForTest(projectRoot, "retry", "# Retry", { status: "ready_for_work" });
        await git(projectRoot, ["add", "docs/plans/retry.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add retry plan"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Retry",
            worktreeRoot,
        });
        const activeWorktree = worktree;
        await savePlanForTest(projectRoot, "retry", "# Retry", {
            status: "implemented",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });
        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "retry",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-02-01T00:00:00.000Z") },
        });
        const snapshot = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "docs/plans/retry.md",
        });

        await assertRejects(() =>
            mergeExecutionWorktree({
                projectRoot,
                branch: activeWorktree.branch,
                targetBranch: "missing-target",
                worktreePath: activeWorktree.path,
                preservePlanPaths: staged.planPaths,
                planName: "retry",
            })
        );
        await restorePrimaryPlanPathAfterMergeFailure(snapshot);
        assertEquals((await loadPlan(projectRoot, "retry"))?.attrs.status, "implemented");
        assertEquals((await loadPlan(activeWorktree.path, "retry"))?.attrs.verifiedAt, "2026-02-01T00:00:00.000Z");

        const retried = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "retry",
            details: { ...TEST_DELIVERY_DETAILS, now: () => new Date("2026-02-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "docs/plans/retry.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: retried.planPaths,
            planName: "retry",
        });

        assertEquals((await loadPlan(projectRoot, "retry"))?.attrs.verifiedAt, "2026-02-01T00:00:00.000Z");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            });
        }
        await removeTempDir(projectRoot);
        await removeTempDir(worktreeRoot).catch(() => {});
    }
});
