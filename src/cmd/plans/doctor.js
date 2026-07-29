/**
 * @module cmd/plans/doctor
 * Report and safely repair Plan/worktree lifecycle drift.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { join } from "@std/path";
import { CLI_BIN, getCwd } from "../../constants.js";
import {
    getPlansDir,
    listArchivedPlans,
    listPlanResources,
    loadPlanStrict,
    parsePlanFrontMatter,
} from "../../plan-store.js";
import { listTransitionRecoveryRecords } from "../../shared/workflow/state-transition.js";
import { listEntries, pruneEntry } from "../../shared/worktree-registry.js";

/**
 * @typedef {Object} DoctorIssue
 * @property {string} kind
 * @property {string} message
 * @property {string} [planName]
 * @property {string} [worktreeId]
 * @property {boolean} [repairable]
 */

function printHelp() {
    console.log(`Usage:
  ${CLI_BIN} plans doctor [--repair]

Reports Plan, lifecycle journal, and worktree registry drift. --repair only applies non-destructive metadata repairs.`);
}

/**
 * @param {string} root
 * @param {string[]} prefix
 * @param {DoctorIssue[]} issues
 * @param {Map<string, string>} planIds
 */
async function collectPlanIssues(root, prefix, issues, planIds) {
    try {
        for await (const entry of Deno.readDir(join(root, ...prefix))) {
            const entryPath = join(root, ...prefix, entry.name);
            const isPlanPath = entry.name.endsWith(".md");
            const planName = isPlanPath ? [...prefix, entry.name.replace(/\.md$/, "")].join("/") : "";
            if (entry.isDirectory) {
                if (isPlanPath) {
                    issues.push({
                        kind: "non_regular_plan_path",
                        planName,
                        message: `${entryPath} is a directory, not a regular Plan markdown file.`,
                    });
                } else if (!(prefix.length === 0 && entry.name === "archived")) {
                    await collectPlanIssues(root, [...prefix, entry.name], issues, planIds);
                }
                continue;
            }
            if (entry.isSymlink && isPlanPath) {
                issues.push({
                    kind: "non_regular_plan_path",
                    planName,
                    message: `${entryPath} is a symlink, not a regular Plan markdown file.`,
                });
                continue;
            }
            if (!isPlanPath) continue;
            const result = await loadPlanStrict(join(root, ".."), planName);
            if (result.kind === "malformed") {
                issues.push({ kind: "malformed_plan", planName, message: result.error.message });
            } else if (result.kind !== "loaded") {
                issues.push({
                    kind: `plan_${result.kind}`,
                    planName,
                    message: "message" in result
                        ? result.message
                        : "error" in result
                        ? result.error.message
                        : entryPath,
                });
            } else {
                collectPlanAttributeIssues({ name: planName, attrs: result.attrs }, issues, planIds);
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

/**
 * @param {{ name: string, attrs: Record<string, any> }} plan
 * @param {DoctorIssue[]} issues
 * @param {Map<string, string>} planIds
 * @param {{ archived?: boolean }} [options]
 */
function collectPlanAttributeIssues(plan, issues, planIds, options = {}) {
    const planName = options.archived ? `archived/${plan.name}` : plan.name;
    if (plan.attrs.planId) {
        const existing = planIds.get(plan.attrs.planId);
        if (existing) {
            issues.push({
                kind: "duplicate_plan_id",
                planName,
                message: `Plan ${planName} and ${existing} both use planId ${plan.attrs.planId}.`,
            });
        } else {
            planIds.set(plan.attrs.planId, planName);
        }
    }
    if (plan.attrs.status === "verified" && plan.attrs.classification === "FEATURE") {
        const evidence = plan.attrs.deliveryEvidence;
        if (!evidence && plan.attrs.executionMode !== "non_git_in_place") {
            issues.push({
                kind: "verified_without_evidence",
                planName,
                message: `${planName} is verified but has no mode-appropriate Delivery Evidence.`,
            });
        }
        if (evidence?.mode === "worktree_merge") {
            if (!evidence.executionCommit || !evidence.targetBranch || !evidence.targetHeadBeforeMerge) {
                issues.push({
                    kind: "uncertain_publication",
                    planName,
                    message:
                        `${planName} has incomplete worktree_merge Delivery Evidence; publication cannot be proven from Plan metadata alone.`,
                });
            }
        }
    }
}

/**
 * @param {string} projectRoot
 * @param {DoctorIssue[]} issues
 * @param {Map<string, string>} planIds
 */
async function collectArchivedPlanParseIssues(projectRoot, issues, planIds) {
    const archivedRoot = join(getPlansDir(projectRoot), "archived");
    /** @param {string[]} prefix */
    async function visit(prefix) {
        try {
            for await (const entry of Deno.readDir(join(archivedRoot, ...prefix))) {
                const entryPath = join(archivedRoot, ...prefix, entry.name);
                const isPlanPath = entry.name.endsWith(".md");
                if (entry.isDirectory) {
                    if (!isPlanPath) await visit([...prefix, entry.name]);
                    continue;
                }
                if (!isPlanPath || entry.isSymlink) continue;
                const planName = [...prefix, entry.name.replace(/\.md$/, "")].join("/");
                try {
                    const parsed = parsePlanFrontMatter(await Deno.readTextFile(entryPath));
                    collectPlanAttributeIssues({ name: planName, attrs: parsed.attrs }, issues, planIds, {
                        archived: true,
                    });
                } catch (error) {
                    issues.push({
                        kind: "malformed_archived_plan",
                        planName,
                        message: `Archived Plan ${planName} is malformed: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    });
                }
            }
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
    }
    await visit([]);
}

/**
 * @param {string} projectRoot
 * @param {string[]} args
 */
async function runGitLines(projectRoot, args) {
    const command = new Deno.Command("git", { args, cwd: projectRoot, stdout: "piped", stderr: "null" });
    const { code, stdout } = await command.output();
    if (code !== 0) return [];
    return new TextDecoder().decode(stdout).split("\n").map((line) => line.trim()).filter(Boolean);
}

/** @param {string} projectRoot @param {string} ancestor @param {string} ref */
async function isGitAncestor(projectRoot, ancestor, ref) {
    const command = new Deno.Command("git", {
        args: ["merge-base", "--is-ancestor", ancestor, ref],
        cwd: projectRoot,
        stdout: "null",
        stderr: "null",
    });
    const { code } = await command.output();
    return code === 0;
}

/** @param {string} projectRoot */
async function listGitWorktreePaths(projectRoot) {
    const lines = await runGitLines(projectRoot, ["worktree", "list", "--porcelain"]);
    return lines
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length).trim())
        .filter(Boolean);
}

/** @param {string} projectRoot @param {boolean} repair */
export async function runPlansDoctor(projectRoot, repair = false) {
    /** @type {DoctorIssue[]} */
    const issues = [];
    const discoveredPlanIds = new Map();
    await collectPlanIssues(getPlansDir(projectRoot), [], issues, discoveredPlanIds);
    await collectArchivedPlanParseIssues(projectRoot, issues, discoveredPlanIds);

    const records = await listTransitionRecoveryRecords(projectRoot);
    for (const record of records) {
        issues.push({
            kind: "unresolved_transition",
            planName: typeof record.planName === "string" ? record.planName : undefined,
            message: `Unresolved transition ${record.transitionId || record.path || "unknown"}: ${
                record.state || "needs_recovery"
            }`,
        });
    }

    let repaired = 0;

    /** @type {Awaited<ReturnType<typeof listEntries>>} */
    let entries = [];
    try {
        entries = await listEntries(projectRoot, { migrate: repair });
    } catch (error) {
        issues.push({
            kind: "registry_integrity_error",
            message: `Worktree registry could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    const registryPaths = new Set(entries.map((entry) => entry.path));
    const gitWorktreePaths = await listGitWorktreePaths(projectRoot);
    for (const path of gitWorktreePaths) {
        if (path !== projectRoot && !registryPaths.has(path)) {
            issues.push({
                kind: "orphan_git_worktree",
                message: `Git worktree ${path} is not recorded in the RunWield worktree registry.`,
            });
        }
    }
    const registryBranches = new Set(entries.map((entry) => entry.branch).filter(Boolean));
    for (
        const branch of await runGitLines(projectRoot, [
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/runwield/worktree",
        ])
    ) {
        if (!registryBranches.has(branch)) {
            issues.push({
                kind: "orphan_worktree_branch",
                message: `RunWield worktree branch ${branch} has no registry entry.`,
            });
        }
    }

    const planResources = await listPlanResources(projectRoot, { backfillMissing: repair }).catch(() => []);
    const archivedPlans = await listArchivedPlans(projectRoot).catch(() => []);
    for (
        const plan of [
            ...planResources,
            ...archivedPlans.map((plan) => ({ ...plan, name: `archived/${plan.name}` })),
        ]
    ) {
        const evidence = plan.attrs.deliveryEvidence;
        if (evidence?.mode === "worktree_merge" && evidence.executionCommit && evidence.targetBranch) {
            if (!(await isGitAncestor(projectRoot, evidence.executionCommit, evidence.targetBranch))) {
                issues.push({
                    kind: "uncertain_publication",
                    planName: plan.name,
                    message:
                        `Delivery Evidence for ${plan.name} says ${evidence.executionCommit} was published to ${evidence.targetBranch}, but Git ancestry does not prove it. Recover by inspecting the worktree branch/transition journal before marking the Plan settled.`,
                });
            }
        }
    }
    const planIds = new Map(planResources.filter((plan) => plan.attrs.planId).map((plan) => [plan.attrs.planId, plan]));
    const activeByPlan = new Map();
    const seenIds = new Set();
    for (const entry of entries) {
        if (seenIds.has(entry.id)) {
            issues.push({
                kind: "duplicate_worktree_id",
                worktreeId: entry.id,
                message: `Duplicate worktree id ${entry.id}.`,
            });
        }
        seenIds.add(entry.id);
        if (!["merged", "abandoned", "removed"].includes(entry.status)) {
            const key = entry.planId || entry.planName;
            const prior = activeByPlan.get(key);
            if (prior) {
                issues.push({
                    kind: "duplicate_live_attempt",
                    planName: entry.planName,
                    worktreeId: entry.id,
                    message: `Plan ${entry.planName} has multiple nonterminal attempts (${prior}, ${entry.id}).`,
                });
            } else {
                activeByPlan.set(key, entry.id);
            }
        }
        if (entry.planId && !planIds.has(entry.planId)) {
            issues.push({
                kind: "registry_plan_id_not_found",
                planName: entry.planName,
                worktreeId: entry.id,
                message: `Registry entry ${entry.id} references missing planId ${entry.planId}.`,
            });
        } else if (entry.planId && planIds.get(entry.planId)?.name !== entry.planName) {
            issues.push({
                kind: "registry_plan_identity_mismatch",
                planName: entry.planName,
                worktreeId: entry.id,
                message:
                    `Registry entry ${entry.id} stores planName ${entry.planName} but planId ${entry.planId} belongs to ${
                        planIds.get(entry.planId)?.name
                    }.`,
            });
        }
        if (!entry.planId) {
            issues.push({
                kind: "registry_missing_plan_id",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: false,
                message:
                    `Registry entry ${entry.id} for ${entry.planName} has no planId; run load-plan or recreate the attempt to bind it safely.`,
            });
        }
        try {
            const stat = await Deno.stat(entry.path);
            if (!stat.isDirectory) throw new Error("not a directory");
        } catch {
            const safelyPrunable = entry.status === "merged" || entry.status === "abandoned";
            issues.push({
                kind: "missing_worktree_path",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: safelyPrunable,
                message: safelyPrunable
                    ? `Registry entry ${entry.id} points at missing settled worktree path ${entry.path}; --repair prunes this stale settled artifact.`
                    : `Registry entry ${entry.id} points at missing active/recoverable worktree path ${entry.path}; inspect the attempt before abandoning it.`,
            });
            if (repair && safelyPrunable) {
                await pruneEntry(projectRoot, entry.id);
                repaired += 1;
            }
        }
    }

    for (const archived of archivedPlans) {
        const status = archived.attrs.worktreeStatus;
        if (status && !["none", "merged", "abandoned"].includes(status)) {
            issues.push({
                kind: "archived_plan_with_recoverable_attempt",
                planName: archived.name,
                message:
                    `Archived Plan ${archived.name} still records recoverable worktreeStatus ${status}; restore and resolve the attempt before archival is considered settled.`,
            });
        }
    }

    return { issues, repaired };
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: { parseArgs?: typeof parseArgsFn, runPlansDoctor?: typeof runPlansDoctor } }} [options]
 */
export async function runPlansDoctorCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    const parseArgs = deps.parseArgs || parseArgsFn;
    const parsed = parseArgs(argv, { boolean: ["help", "repair"], alias: { h: "help" } });
    if (parsed.help) {
        printHelp();
        return;
    }
    const runDoctor = deps.runPlansDoctor || runPlansDoctor;
    const result = await runDoctor(getCwd(), Boolean(parsed.repair));
    if (result.issues.length === 0) {
        console.log("[RunWield] Plans doctor found no lifecycle/worktree drift.");
        return;
    }
    console.log("[RunWield] Plans doctor found issues:\n");
    for (const issue of result.issues) {
        console.log(`  - ${issue.kind}: ${issue.message}`);
    }
    if (parsed.repair) console.log(`\n[RunWield] Applied ${result.repaired} safe repair(s).`);
}
