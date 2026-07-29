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
