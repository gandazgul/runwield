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
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";

type WorktreeRegistryEntry = import("../../shared/worktree-registry.js").WorktreeRegistryEntry;
type WorktreeDeliveryEvidence = import("../../plan-store.js").WorktreeDeliveryEvidence;

interface DoctorCommandFixture {
    projectRoot: string;
}

interface RegistryFixtureEntry {
    id: string;
    planName: string;
    planId?: string;
    baseBranch: string;
    baseRef: string;
    baseCommit: string;
    branch: string;
    path: string;
    status: string;
    createdAt: string;
    updatedAt: string;
}

interface RegistryFixtureFile {
    version: number;
    entries: RegistryFixtureEntry[];
}

async function withDoctorCommandFixture(run: (fixture: DoctorCommandFixture) => Promise<void>): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const previousSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const previousCwd = Deno.cwd();
        const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-command-" });
        const homeDir = join(fixtureRoot, "home");
        const projectRoot = join(fixtureRoot, "project");
        await Promise.all([
            Deno.mkdir(homeDir, { recursive: true }),
            Deno.mkdir(projectRoot, { recursive: true }),
        ]);
        try {
            Deno.env.set("HOME", homeDir);
            Deno.env.set("WLD_TEST_SANDBOX_HOME", homeDir);
            Deno.chdir(projectRoot);
            await run({ projectRoot });
        } finally {
            Deno.chdir(previousCwd);
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            if (previousSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", previousSandboxHome);
            await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
        }
    });
}

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
    }
    return logs.join("\n");
}

async function seedMissingSettledWorktree(projectRoot: string, worktreeId: string): Promise<void> {
    await savePlan(projectRoot, "demo", "# Demo\n", {
        planId: "plan-command-demo",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "Doctor command fixture.",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "implemented",
        worktreeId,
        worktreeStatus: "abandoned",
    });
    await addEntry(projectRoot, {
        id: worktreeId,
        planName: "demo",
        planId: "plan-command-demo",
        baseBranch: "main",
        baseRef: "HEAD",
        baseCommit: "abc",
        branch: `runwield/worktree/demo-${worktreeId}`,
        path: join(projectRoot, "missing-worktree"),
        status: "abandoned",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    });
}

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
            status: "abandoned",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const report = await runPlansDoctor(cwd, true);
        assertEquals(report.issues.some((issue) => issue.kind === "missing_worktree_path"), false);
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
        const beforePlan = await Deno.readTextFile(join(cwd, "docs", "plans", "missing-id.md"));
        const beforeRegistry = await Deno.readTextFile(registryPath);

        const report = await runPlansDoctor(cwd, false);
        assertEquals(report.issues.some((issue) => issue.kind === "registry_missing_plan_id"), true);
        assertEquals(await Deno.readTextFile(join(cwd, "docs", "plans", "missing-id.md")), beforePlan);
        assertEquals(await Deno.readTextFile(registryPath), beforeRegistry);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plans doctor ignores Epic manual QA artifacts", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plans-doctor-manual-qa-" });
    try {
        await Deno.mkdir(join(cwd, "docs", "plans", "tow-mvp-epic"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "docs", "plans", "tow-mvp-epic", "manual-qa.md"),
            "# Manual QA\n",
        );
        await Deno.mkdir(join(cwd, "docs", "plans", "archived", "tow-mvp-epic"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "docs", "plans", "archived", "tow-mvp-epic", "manual-qa.md"),
            "---\n: bad yaml\n---\n# Archived Manual QA\n",
        );

        const report = await runPlansDoctor(cwd, false);
        assertEquals(report.issues, []);
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
        await Deno.mkdir(join(cwd, "docs", "plans", "archived"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "docs", "plans", "archived", "old.md"),
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

Deno.test("plans doctor repairs every safe issue to a fixed point and preserves protected work", async () => {
    await withDoctorCommandFixture(async ({ projectRoot }) => {
        await seedMissingSettledWorktree(projectRoot, "wt-command-report");

        const output = await captureConsoleLog(async () => {
            await runPlansDoctorCommand([]);
        });

        assertEquals(output.includes("Fixed 1 safe Plan problem"), true);
        assertEquals(output.includes("registry"), false);
        assertEquals(await findById(projectRoot, "wt-command-report"), null);
        const secondOutput = await captureConsoleLog(async () => {
            await runPlansDoctorCommand([]);
        });
        assertEquals(secondOutput.includes("Your Plans look good"), true);
    });
});

Deno.test("plans doctor command --check reports without changing files", async () => {
    await withDoctorCommandFixture(async ({ projectRoot }) => {
        await seedMissingSettledWorktree(projectRoot, "wt-command-check");
        const registryPath = getWorktreeRegistryPath(projectRoot);
        const before = await Deno.readTextFile(registryPath);

        const output = await captureConsoleLog(async () => {
            await runPlansDoctorCommand(["--check"]);
        });

        assertEquals(await Deno.readTextFile(registryPath), before);
        assertEquals((await findById(projectRoot, "wt-command-check"))?.status, "abandoned");
        assertEquals(output.includes("Plans doctor diagnosis: 1 issue found"), true);
        assertEquals(output.includes("Worktree registry"), true);
        assertEquals(output.includes("wt-command-check"), true);
        assertEquals(output.includes("Next steps:"), true);
        assertEquals(output.includes("No files changed"), true);
    });
});

Deno.test("plans doctor command --repair applies safe repairs through the real doctor", async () => {
    await withDoctorCommandFixture(async ({ projectRoot }) => {
        await seedMissingSettledWorktree(projectRoot, "wt-command-repair");

        const output = await captureConsoleLog(async () => {
            await runPlansDoctorCommand(["--repair"]);
        });

        assertEquals(await findById(projectRoot, "wt-command-repair"), null);
        assertEquals(output.includes("Fixed 1 safe Plan problem"), true);
        assertEquals(output.includes("look good now"), true);
        assertEquals(output.includes("Worktree registry"), false);
        assertEquals(output.includes("Diagnosis:"), false);
        assertEquals(output.includes("Next steps:"), false);
    });
});

Deno.test("plans doctor command --repair summarizes remaining problems without repeating their details", async () => {
    await withDoctorCommandFixture(async ({ projectRoot }) => {
        await seedMissingSettledWorktree(projectRoot, "wt-command-partial-repair");
        await Deno.writeTextFile(join(projectRoot, "docs", "plans", "broken.md"), "---\nstatus: [\n---\n# Broken\n");

        const output = await captureConsoleLog(async () => {
            await runPlansDoctorCommand(["--repair"]);
        });

        assertEquals(output.includes("Fixed 1 safe problem"), true);
        assertEquals(output.includes("1 problem needs your attention"), true);
        assertEquals(output.includes("run wld plans doctor --check to see them"), true);
        assertEquals(output.includes("broken"), false);
        assertEquals(output.includes("Plan files"), false);
        assertEquals(output.includes("Diagnosis:"), false);
        assertEquals(output.includes("Next steps:"), false);
    });
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
        const base: Omit<WorktreeRegistryEntry, "id" | "planName" | "branch" | "path"> = {
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
        const registry = JSON.parse(await Deno.readTextFile(registryPath)) as RegistryFixtureFile;
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
        await Deno.mkdir(join(cwd, "docs", "plans", "archived"), { recursive: true });
        await Deno.writeTextFile(
            join(cwd, "docs", "plans", "archived", "done.md"),
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
            status: "abandoned",
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

        // Read-only mode names the conflict. Repair mode can bind the attempt named
        // by the Plan and leave every other worktree untouched.
        for (const repair of [false]) {
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
            status: "validation_failed",
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
                await markEffect("worktree_registry_updated", { worktreeId: "wt-1", status: "validation_failed" });
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
        assertEquals((await findById(cwd, "wt-1"))?.status, "validation_failed", "the attempt is left untouched");
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

        const evidenceFor = (commit: string): WorktreeDeliveryEvidence => ({
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
