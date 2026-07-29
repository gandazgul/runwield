import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { injectFrontMatter, savePlan } from "../../plan-store.js";
import { getRunWieldRuntimeDir, PLAN_LOCKS_DIR_NAME } from "../../constants.js";
import { addEntry, findById, getWorktreeRegistryPath, listEntries } from "../../shared/worktree-registry.js";
import {
    listTransitionRecoveryRecords,
    runExecutionPreparationTransition,
    runValidationOutcomeTransition,
} from "../../shared/workflow/state-transition.ts";
import { runPlansDoctor, runPlansDoctorCommand } from "./doctor.ts";
import { defineGitFixture, git } from "../../shared/git-test-fixture.ts";

// main, plus a side branch carrying work that never reached it.
const ancestryRepo = defineGitFixture(async (repo) => {
    await Deno.writeTextFile(join(repo, "file.txt"), "base\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "base"]);
    await git(repo, ["checkout", "-b", "side"]);
    await Deno.writeTextFile(join(repo, "file.txt"), "unpublished\n");
    await git(repo, ["commit", "-am", "unpublished"]);
    await git(repo, ["checkout", "main"]);
});

Deno.test("plans doctor reports missing worktree paths without abandoning attempts automatically", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-" });
    try {
        await addEntry(cwd, {
            id: "wt1",
            planName: "demo",
            planId: "plan-1",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            branch: "runwield/worktree/demo-wt1",
            path: `${cwd}/missing-worktree`,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const report = await runPlansDoctor(cwd, true);
        assertEquals(report.issues.some((issue) => issue.kind === "missing_worktree_path"), true);
        assertEquals(report.repaired, 0);
        assertEquals((await findById(cwd, "wt1"))?.status, "active");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor repair prunes missing settled worktree registry artifacts", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-prune-" });
    try {
        await addEntry(cwd, {
            id: "wt-settled",
            planName: "demo",
            planId: "plan-1",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            branch: "runwield/worktree/demo-wt-settled",
            path: `${cwd}/missing-merged-worktree`,
            status: "merged",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const report = await runPlansDoctor(cwd, true);
        assertEquals(report.issues.some((issue) => issue.kind === "missing_worktree_path"), true);
        assertEquals(report.repaired, 1);
        assertEquals(await listEntries(cwd), []);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor is report-only without repair", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-readonly-" });
    try {
        await savePlan(cwd, "missing-id", "# Missing", { status: "ready_for_work", classification: "FEATURE" });
        const registryPath = getWorktreeRegistryPath(cwd);
        await Deno.mkdir(join(cwd, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            registryPath,
            JSON.stringify({
                version: 1,
                entries: [{
                    id: "legacy-wt",
                    planName: "missing-id",
                    baseBranch: "main",
                    baseRef: "HEAD",
                    baseCommit: "abc",
                    branch: "runwield/worktree/missing-id-legacy-wt",
                    path: `${cwd}/missing-worktree`,
                    status: "active",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                }],
            }),
        );
        const beforePlan = await Deno.readTextFile(join(cwd, "plans", "missing-id.md"));
        const beforeRegistry = await Deno.readTextFile(registryPath);

        const report = await runPlansDoctor(cwd, false);
        assertEquals(report.issues.some((issue) => issue.kind === "registry_missing_plan_id"), true);
        assertEquals(await Deno.readTextFile(join(cwd, "plans", "missing-id.md")), beforePlan);
        assertEquals(await Deno.readTextFile(registryPath), beforeRegistry);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor applies identity and evidence checks to archived Plans", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-archived-" });
    try {
        await savePlan(cwd, "active", "# Active", {
            planId: "same-plan-id",
            status: "ready_for_work",
            classification: "FEATURE",
        });
        await Deno.mkdir(join(cwd, "plans", "archived"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "plans", "archived", "old.md"),
            injectFrontMatter("# Old", {
                planId: "same-plan-id",
                status: "verified",
                classification: "FEATURE",
                deliveryEvidence: {
                    version: 1,
                    mode: "worktree_merge",
                    executionCommit: "a".repeat(40),
                    targetBranch: "main",
                    targetHeadBeforeMerge: "b".repeat(40),
                },
            }),
        );

        const report = await runPlansDoctor(cwd, false);
        assertEquals(report.issues.some((issue) => issue.kind === "duplicate_plan_id"), true);
        assertEquals(report.issues.some((issue) => issue.kind === "uncertain_publication"), true);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor command prints grouped diagnosis with actionable next steps", async () => {
    const originalLog = console.log;
    /** @type {string[]} */
    const logs = [];
    console.log = (message = "") => logs.push(String(message));
    try {
        await runPlansDoctorCommand([], {
            __testDeps: {
                runPlansDoctor: () =>
                    Promise.resolve({
                        repaired: 0,
                        issues: [{
                            kind: "missing_worktree_path",
                            planName: "demo",
                            worktreeId: "wt1",
                            repairable: true,
                            message: "Registry entry wt1 points at missing settled worktree path /tmp/demo.",
                        }],
                    }),
            },
        });
    } finally {
        console.log = originalLog;
    }
    const output = logs.join("\n");
    assertEquals(output.includes("Plans doctor diagnosis: 1 issue found"), true);
    assertEquals(output.includes("Worktree registry"), true);
    assertEquals(
        output.includes("Diagnosis: A settled registry entry points at a worktree path that no longer exists."),
        true,
    );
    assertEquals(output.includes("Next steps:"), true);
    assertEquals(output.includes("Run plans doctor --repair"), true);
});

Deno.test("plans doctor --repair fixes provable registry drift without touching Git artifacts", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-repair-" });
    try {
        await savePlan(cwd, "renamed-plan", "# Renamed\n", {
            planId: "plan-a",
            classification: "FEATURE",
            status: "in_progress",
            summary: "s",
            affectedPaths: [],
            worktreeId: "wt-a",
        });
        await savePlan(cwd, "legacy-plan", "# Legacy\n", {
            planId: "plan-b",
            classification: "FEATURE",
            status: "in_progress",
            summary: "s",
            affectedPaths: [],
            worktreeId: "wt-b",
        });
        const base = {
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        // planName drifted away from the Plan that owns the planId.
        await addEntry(cwd, {
            ...base,
            id: "wt-a",
            planName: "old-name",
            planId: "plan-a",
            branch: "runwield/worktree/a",
            path: join(cwd, "wt-a"),
        });
        // Legacy entry with no planId, but the Plan points back at this exact
        // attempt. addEntry refuses to create one, so write it as v1 data would be.
        const registryPath = getWorktreeRegistryPath(cwd);
        const registry = JSON.parse(await Deno.readTextFile(registryPath));
        registry.entries.push({
            ...base,
            id: "wt-b",
            planName: "stale-legacy-name",
            branch: "runwield/worktree/b",
            path: join(cwd, "wt-b"),
        });
        await Deno.writeTextFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

        const report = await runPlansDoctor(cwd, true);
        assertEquals(report.repaired >= 2, true, `expected both drifts repaired, got ${report.repaired}`);
        assertEquals((await findById(cwd, "wt-a"))?.planName, "renamed-plan");
        // Bound by the Plan's worktreeId back-pointer, which name-based migration
        // cannot use because the entry's cached name no longer matches any Plan.
        assertEquals((await findById(cwd, "wt-b"))?.planId, "plan-b");
        assertEquals((await findById(cwd, "wt-b"))?.planName, "legacy-plan");
        // Repair is metadata-only: no attempt may be removed.
        assertEquals((await listEntries(cwd)).length, 2);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor does not report an archived Plan's attempt as a dangling planId", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-archived-" });
    try {
        await Deno.mkdir(join(cwd, "plans", "archived"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "plans", "archived", "done.md"),
            injectFrontMatter("# Done\n", {
                planId: "plan-archived",
                classification: "FEATURE",
                status: "verified",
                summary: "s",
                affectedPaths: [],
            }),
        );
        await addEntry(cwd, {
            id: "wt-archived",
            planName: "done",
            planId: "plan-archived",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            branch: "runwield/worktree/done",
            path: join(cwd, "wt-archived"),
            status: "merged",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const report = await runPlansDoctor(cwd, false);
        assertEquals(
            report.issues.some((issue) => issue.kind === "registry_plan_id_not_found"),
            false,
            "an archived Plan still owns its planId",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor diagnoses a registry conflict instead of going blind on it", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-conflict-" });
    try {
        await savePlan(cwd, "demo", "# Demo\n", {
            planId: "plan-1",
            classification: "FEATURE",
            status: "in_progress",
            summary: "s",
            affectedPaths: [],
            worktreeId: "wt-a",
        });
        const base = {
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        // Two live attempts for one Plan: legacy v1 shape, which the invariant-enforcing
        // readers refuse to load at all.
        await Deno.mkdir(join(cwd, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            getWorktreeRegistryPath(cwd),
            JSON.stringify({
                version: 1,
                entries: [
                    {
                        ...base,
                        id: "wt-a",
                        planName: "demo",
                        branch: "rw/a",
                        path: join(cwd, "wt-a"),
                        status: "completed",
                    },
                    {
                        ...base,
                        id: "wt-b",
                        planName: "demo",
                        branch: "rw/b",
                        path: join(cwd, "wt-b"),
                        status: "active",
                    },
                ],
            }),
        );

        // --repair must not report less than a read-only run: a violated invariant is
        // exactly when the per-entry detail matters most.
        for (const repair of [false, true]) {
            const report = await runPlansDoctor(cwd, repair);
            const kinds = report.issues.map((issue) => issue.kind);
            assertEquals(
                kinds.includes("registry_integrity_error"),
                false,
                `repair=${repair}: "could not be loaded" is not a diagnosis`,
            );
            assertEquals(kinds.includes("duplicate_live_attempt"), true, `repair=${repair}: names the conflict`);
            const conflict = report.issues.find((issue) => issue.kind === "duplicate_live_attempt");
            assertEquals(conflict?.message.includes("wt-a"), true);
            assertEquals(conflict?.message.includes("wt-b"), true);
            assertEquals((conflict?.commands || []).length > 0, true, "the user needs commands, not a verdict");
        }
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor closes a journal whose durable effects the repository proves", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-journal-" });
    try {
        await savePlan(cwd, "demo", "# Demo\n", {
            planId: "plan-1",
            classification: "FEATURE",
            status: "implemented",
            summary: "s",
            affectedPaths: [],
        });
        await addEntry(cwd, {
            id: "wt-1",
            planName: "demo",
            planId: "plan-1",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "abc",
            branch: "runwield/worktree/demo",
            path: join(cwd, "wt-1"),
            status: "merge_conflict",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        // A merge-failure settlement interrupted after its registry write: the effect is
        // atomic, so there is no half-applied row to be afraid of.
        const failure = await runValidationOutcomeTransition({
            projectRoot: cwd,
            planName: "demo",
            worktreeId: "wt-1",
            outcome: "merge_failed",
            settle: async ({ markEffect }) => {
                await markEffect("worktree_registry_updated", { worktreeId: "wt-1", status: "merge_conflict" });
                throw new Error("interrupted before settling");
            },
        });
        assertEquals(failure.status, "needs_recovery");

        const reported = await runPlansDoctor(cwd, false);
        const unresolved = reported.issues.find((issue) => issue.kind === "unresolved_transition");
        assertEquals(Boolean(unresolved), true);
        assertEquals(unresolved?.repairable, true);
        assertEquals(unresolved?.message.includes("demo"), true, "the message names the Plan, not just an id");

        const repaired = await runPlansDoctor(cwd, true);
        assertEquals(repaired.repaired >= 1, true);
        assertEquals(
            repaired.issues.some((issue) => issue.kind === "unresolved_transition"),
            false,
            "RunWield must be able to close its own bookkeeping",
        );
        assertEquals((await listTransitionRecoveryRecords(cwd)).length, 0);
        assertEquals((await findById(cwd, "wt-1"))?.status, "merge_conflict", "the attempt is left untouched");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor keeps a journal whose worktree may still hold work", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-keep-" });
    try {
        await savePlan(cwd, "demo", "# Demo\n", {
            planId: "plan-1",
            classification: "FEATURE",
            status: "ready_for_work",
            summary: "s",
            affectedPaths: [],
        });
        const orphanPath = join(cwd, "orphan-worktree");
        await Deno.mkdir(orphanPath, { recursive: true });
        const failure = await runExecutionPreparationTransition({
            projectRoot: cwd,
            planName: "demo",
            worktreeId: "wt-1",
            prepare: async ({ markEffect }) => {
                await markEffect("git_worktree_created", { worktreeId: "wt-1", path: orphanPath, branch: "rw/demo" });
                throw new Error("registry settlement interrupted");
            },
        });
        assertEquals(failure.status, "needs_recovery");

        const report = await runPlansDoctor(cwd, true);
        const unresolved = report.issues.find((issue) => issue.kind === "unresolved_transition");
        assertEquals(Boolean(unresolved), true, "an unclaimed worktree is never closed automatically");
        assertEquals(unresolved?.repairable, false);
        assertEquals(unresolved?.message.includes(orphanPath), true, "the message names the directory to inspect");
        assertEquals(
            (unresolved?.commands || []).some((command) => command.includes(orphanPath)),
            true,
            "and the command that shows whether anything is in it",
        );
        assertEquals(await Deno.stat(orphanPath).then((stat) => stat.isDirectory), true, "nothing is deleted");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor clears an abandoned Plan lock", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-lock-" });
    try {
        // Ask where locks live rather than hardcoding it: under a sandboxed test run
        // they are namespaced per run so two suites cannot block each other.
        const lockDir = join(getRunWieldRuntimeDir(cwd), PLAN_LOCKS_DIR_NAME);
        const lockPath = join(lockDir, "demo.lock");
        await Deno.mkdir(lockDir, { recursive: true });
        await Deno.writeTextFile(lockPath, JSON.stringify({ pid: 999999, updatedAtMs: 0 }));
        const old = new Date(Date.now() - 60 * 60_000);
        await Deno.utime(lockPath, old, old);

        const reported = await runPlansDoctor(cwd, false);
        const stale = reported.issues.find((issue) => issue.kind === "stale_plan_lock");
        assertEquals(Boolean(stale), true);
        assertEquals(stale?.repairable, true);
        assertEquals(await Deno.stat(lockPath).then(() => true), true, "report-only leaves it in place");

        const repaired = await runPlansDoctor(cwd, true);
        assertEquals(repaired.repaired >= 1, true);
        assertEquals(await Deno.stat(lockPath).then(() => true).catch(() => false), false);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("doctor proves publication from real Git ancestry in both directions", async () => {
    // The only test here that runs real Git, and the reason it has to: every other
    // ancestry assertion lives in a directory with no repository, where the check
    // fails for lack of Git rather than for lack of ancestry. Those tests would pass
    // just as happily with the arguments reversed. This one pins what
    // `merge-base --is-ancestor` actually means for us, so the faked tests above are
    // safe to trust about everything else.
    const cwd = await ancestryRepo.checkout({ prefix: "runwield-plans-doctor-git-" });
    try {
        const publishedCommit = await git(cwd, ["rev-parse", "main"]);
        const unpublishedCommit = await git(cwd, ["rev-parse", "side"]);

        const evidenceFor = (/** @type {string} */ commit) => ({
            version: 1,
            mode: "worktree_merge",
            executionCommit: commit,
            targetBranch: "main",
            targetHeadBeforeMerge: publishedCommit,
        });

        await savePlan(cwd, "published", "# Published\n", {
            planId: "plan-published",
            classification: "FEATURE",
            status: "verified",
            summary: "s",
            affectedPaths: [],
            deliveryEvidence: evidenceFor(publishedCommit),
        });
        const publishedReport = await runPlansDoctor(cwd, false);
        assertEquals(
            publishedReport.issues.some((issue) => issue.kind === "uncertain_publication"),
            false,
            "a commit contained in the target branch is proven published",
        );

        await savePlan(cwd, "unpublished", "# Unpublished\n", {
            planId: "plan-unpublished",
            classification: "FEATURE",
            status: "verified",
            summary: "s",
            affectedPaths: [],
            deliveryEvidence: evidenceFor(unpublishedCommit),
        });
        const unpublishedReport = await runPlansDoctor(cwd, false);
        const uncertain = unpublishedReport.issues.filter((issue) => issue.kind === "uncertain_publication");
        assertEquals(uncertain.length, 1, "a commit that never reached the target branch is not proven");
        assertEquals(uncertain[0].planName, "unpublished");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
