import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { injectFrontMatter, savePlan } from "../../plan-store.js";
import { addEntry, findById, getWorktreeRegistryPath, listEntries } from "../../shared/worktree-registry.js";
import { runPlansDoctor, runPlansDoctorCommand } from "./doctor.ts";

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
