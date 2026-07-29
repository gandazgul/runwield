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
import { reconcileTransitionRecoveryRecords } from "../../shared/workflow/state-transition.ts";
import { listEntries, pruneEntry, reconcileEntryIdentity } from "../../shared/worktree-registry.js";

/** Delivery Evidence as read from Plan Front Matter, before any field is proven. */
interface DeliveryEvidenceSnapshot {
    mode?: unknown;
    executionCommit?: unknown;
    targetBranch?: unknown;
    targetHeadBeforeMerge?: unknown;
}

interface DoctorIssue {
    kind: string;
    message: string;
    planName?: string;
    worktreeId?: string;
    repairable?: boolean;
}

interface IssueGuidance {
    category: string;
    severity: "Critical" | "Needs attention" | "Cleanup";
    diagnosis: string;
    nextSteps: string[];
}

function printHelp() {
    console.log(`Usage:
  ${CLI_BIN} plans doctor [--repair]

Diagnoses Plan, lifecycle journal, and worktree registry drift. --repair only applies non-destructive metadata repairs.`);
}

function getIssueGuidance(issue: DoctorIssue): IssueGuidance {
    switch (issue.kind) {
        case "malformed_plan":
        case "malformed_archived_plan":
        case "non_regular_plan_path":
            return {
                category: "Plan files",
                severity: "Critical",
                diagnosis: "RunWield cannot reliably read this Plan file.",
                nextSteps: [
                    "Open the named file and fix the front matter or replace the unexpected path with a regular .md file.",
                    "Run plans doctor again before loading or archiving this Plan.",
                ],
            };
        case "duplicate_plan_id":
            return {
                category: "Plan identity",
                severity: "Critical",
                diagnosis:
                    "Two Plans claim the same stable identity, so lifecycle state can be attached to the wrong Plan.",
                nextSteps: [
                    "Inspect both Plans and decide which one owns the planId.",
                    "Do not hand-edit lifecycle metadata unless you are intentionally repairing identity state; prefer restoring from the correct Plan source.",
                ],
            };
        case "verified_without_evidence":
        case "uncertain_publication":
            return {
                category: "Delivery evidence",
                severity: "Needs attention",
                diagnosis:
                    "The Plan says it reached a terminal state, but the evidence is incomplete or Git cannot prove publication.",
                nextSteps: [
                    "Inspect the Plan, worktree branch, and transition journal before trusting the verified status.",
                    "If the work was published, capture or restore the missing evidence; otherwise reopen/recover the Plan through RunWield.",
                ],
            };
        case "unresolved_transition":
            return {
                category: "Lifecycle transitions",
                severity: "Critical",
                diagnosis:
                    "A lifecycle transaction did not finish cleanly and blocks further work on its Plan until it is resolved.",
                nextSteps: [
                    `Run ${CLI_BIN} plans doctor --repair to close records that repository facts prove are already settled.`,
                    `If it remains, run ${CLI_BIN} load-plan <plan> and choose a recovery action; recovery supersedes the record and clears it on success.`,
                    "Records naming durable effects are left in place on purpose: confirm the worktree, branch, and target ref before forcing them.",
                ],
            };
        case "registry_integrity_error":
            return {
                category: "Worktree registry",
                severity: "Critical",
                diagnosis: "RunWield could not load its worktree registry, so active attempt state may be hidden.",
                nextSteps: [
                    "Inspect .wld/worktrees.json for invalid JSON or schema drift.",
                    "Restore the registry from backup or repair it before creating, merging, or abandoning worktrees.",
                ],
            };
        case "orphan_git_worktree":
            return {
                category: "Git worktrees",
                severity: "Needs attention",
                diagnosis: "Git knows about a RunWield-looking worktree that RunWield is not tracking.",
                nextSteps: [
                    "Inspect the worktree path and identify whether it contains in-progress Plan work.",
                    "If it is stale, remove it with git worktree remove; if it is active, recover or recreate the RunWield attempt record.",
                ],
            };
        case "orphan_worktree_branch":
            return {
                category: "Git branches",
                severity: "Cleanup",
                diagnosis: "A RunWield worktree branch exists without a matching active registry entry.",
                nextSteps: [
                    "Inspect the branch for unmerged work before deleting it.",
                    "Delete the branch only after confirming it is stale or already published.",
                ],
            };
        case "duplicate_worktree_id":
        case "duplicate_live_attempt":
        case "registry_plan_id_not_found":
        case "registry_plan_identity_mismatch":
        case "registry_missing_plan_id":
            return {
                category: "Worktree registry",
                severity: "Critical",
                diagnosis: "The registry does not agree with Plan identity or active-attempt invariants.",
                nextSteps: [
                    "Do not start another attempt for this Plan until the registry entry is understood.",
                    "Use load-plan or the relevant recovery flow to re-bind the attempt; recreate only if the worktree is disposable.",
                ],
            };
        case "missing_worktree_path":
            return {
                category: "Worktree registry",
                severity: issue.repairable ? "Cleanup" : "Critical",
                diagnosis: issue.repairable
                    ? "A settled registry entry points at a worktree path that no longer exists."
                    : "An active or recoverable attempt points at a missing worktree path.",
                nextSteps: issue.repairable
                    ? [
                        "Run plans doctor --repair to prune this stale settled registry entry.",
                        "No source work should be lost because the attempt is already settled.",
                    ]
                    : [
                        "Find whether the worktree was moved, deleted, or never created.",
                        "Recover the path or explicitly abandon the attempt through RunWield after confirming there is no work to save.",
                    ],
            };
        case "archived_plan_with_recoverable_attempt":
            return {
                category: "Archived Plans",
                severity: "Needs attention",
                diagnosis: "An archived Plan still claims there is recoverable worktree state.",
                nextSteps: [
                    "Restore the Plan from archived status before acting on the attempt.",
                    "Resolve, merge, or abandon the attempt, then archive the Plan again when it is settled.",
                ],
            };
        default:
            return {
                category: "Other drift",
                severity: "Needs attention",
                diagnosis: "RunWield found Plan or worktree state that does not match its expected lifecycle model.",
                nextSteps: [
                    "Read the raw detail above and inspect the named Plan/worktree before making lifecycle changes.",
                    "Run plans doctor again after repairing the underlying state.",
                ],
            };
    }
}

function formatDoctorReport(issues: DoctorIssue[], repaired: number, repair: boolean) {
    const byCategory = new Map<string, DoctorIssue[]>();
    for (const issue of issues) {
        const guidance = getIssueGuidance(issue);
        const categoryIssues = byCategory.get(guidance.category) || [];
        categoryIssues.push(issue);
        byCategory.set(guidance.category, categoryIssues);
    }

    const severityCounts = issues.reduce((counts, issue) => {
        const severity = getIssueGuidance(issue).severity;
        counts.set(severity, (counts.get(severity) || 0) + 1);
        return counts;
    }, new Map<IssueGuidance["severity"], number>());
    const lines = [
        `[RunWield] Plans doctor diagnosis: ${issues.length} issue${issues.length === 1 ? "" : "s"} found.`,
        `Summary: ${
            ["Critical", "Needs attention", "Cleanup"].map((severity) =>
                `${severity}: ${severityCounts.get(severity as IssueGuidance["severity"]) || 0}`
            ).join(" · ")
        }`,
        "",
    ];

    for (const [category, categoryIssues] of byCategory) {
        lines.push(`${category}`);
        lines.push("-".repeat(category.length));
        categoryIssues.forEach((issue, index) => {
            const guidance = getIssueGuidance(issue);
            const affected = [
                issue.planName ? `Plan: ${issue.planName}` : undefined,
                issue.worktreeId ? `Worktree: ${issue.worktreeId}` : undefined,
            ].filter(Boolean).join(" · ");
            lines.push(`${index + 1}. [${guidance.severity}] ${issue.kind}`);
            if (affected) lines.push(`   Affected: ${affected}`);
            lines.push(`   Diagnosis: ${guidance.diagnosis}`);
            lines.push(`   Detail: ${issue.message}`);
            lines.push("   Next steps:");
            for (const step of guidance.nextSteps) lines.push(`   - ${step}`);
            if (issue.repairable) lines.push("   Repair: Safe automated repair is available with --repair.");
            lines.push("");
        });
    }

    if (repair) lines.push(`[RunWield] Applied ${repaired} safe repair(s).`);
    else if (issues.some((issue) => issue.repairable)) {
        lines.push(`[RunWield] Some cleanup is safe to automate. Re-run: ${CLI_BIN} plans doctor --repair`);
    }
    return lines.join("\n").trimEnd();
}

async function collectPlanIssues(
    root: string,
    prefix: string[],
    issues: DoctorIssue[],
    planIds: Map<string, string>,
) {
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

function collectPlanAttributeIssues(
    plan: { name: string; attrs: Record<string, unknown> },
    issues: DoctorIssue[],
    planIds: Map<string, string>,
    options: { archived?: boolean } = {},
) {
    const planName = options.archived ? `archived/${plan.name}` : plan.name;
    const planId = typeof plan.attrs.planId === "string" ? plan.attrs.planId : "";
    if (planId) {
        const existing = planIds.get(planId);
        if (existing) {
            issues.push({
                kind: "duplicate_plan_id",
                planName,
                message: `Plan ${planName} and ${existing} both use planId ${planId}.`,
            });
        } else {
            planIds.set(planId, planName);
        }
    }
    if (plan.attrs.status === "verified" && plan.attrs.classification === "FEATURE") {
        const evidence = plan.attrs.deliveryEvidence as DeliveryEvidenceSnapshot | undefined;
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

async function collectArchivedPlanParseIssues(
    projectRoot: string,
    issues: DoctorIssue[],
    planIds: Map<string, string>,
) {
    const archivedRoot = join(getPlansDir(projectRoot), "archived");

    async function visit(prefix: string[]) {
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

async function runGitLines(projectRoot: string, args: string[]) {
    const command = new Deno.Command("git", { args, cwd: projectRoot, stdout: "piped", stderr: "null" });
    const { code, stdout } = await command.output();
    if (code !== 0) return [];
    return new TextDecoder().decode(stdout).split("\n").map((line) => line.trim()).filter(Boolean);
}

async function isGitAncestor(projectRoot: string, ancestor: string, ref: string) {
    const command = new Deno.Command("git", {
        args: ["merge-base", "--is-ancestor", ancestor, ref],
        cwd: projectRoot,
        stdout: "null",
        stderr: "null",
    });
    const { code } = await command.output();
    return code === 0;
}

async function listGitWorktreePaths(projectRoot: string) {
    const lines = await runGitLines(projectRoot, ["worktree", "list", "--porcelain"]);
    return lines
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length).trim())
        .filter(Boolean);
}

export async function runPlansDoctor(projectRoot: string, repair = false) {
    const issues: DoctorIssue[] = [];
    const discoveredPlanIds = new Map<string, string>();
    await collectPlanIssues(getPlansDir(projectRoot), [], issues, discoveredPlanIds);
    await collectArchivedPlanParseIssues(projectRoot, issues, discoveredPlanIds);

    let repaired = 0;

    // Retire the journals whose records repository facts prove are finished.
    // Until one is cleared it blocks every later transition on its Plan, so
    // leaving a provably-settled record in place would strand the Plan.
    const reconciliations = await reconcileTransitionRecoveryRecords(projectRoot, { apply: repair });
    for (const reconciliation of reconciliations) {
        if (reconciliation.resolved) {
            repaired += 1;
            continue;
        }
        issues.push({
            kind: "unresolved_transition",
            planName: reconciliation.planName,
            repairable: reconciliation.resolvable,
            message: `Unresolved transition ${reconciliation.transitionId || "unknown"} (${
                reconciliation.operation || "unknown operation"
            }, ${reconciliation.state || "needs_recovery"}): ${reconciliation.reason}`,
        });
    }

    let entries: Awaited<ReturnType<typeof listEntries>> = [];
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
    // Archived Plans keep their planId and can still own a recoverable attempt,
    // so resolving ids from active Plans alone reports a healthy archived attempt
    // as a dangling reference. Track both, and remember which is which.
    const planIdOwners = new Map<string, { name: string; archived: boolean }>();
    for (const plan of planResources) {
        if (plan.attrs.planId) planIdOwners.set(plan.attrs.planId, { name: plan.name, archived: false });
    }
    for (const plan of archivedPlans) {
        const planId = (plan.attrs as { planId?: unknown }).planId;
        if (typeof planId === "string" && !planIdOwners.has(planId)) {
            planIdOwners.set(planId, { name: plan.name, archived: true });
        }
    }
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
        if (entry.planId && !planIdOwners.has(entry.planId)) {
            issues.push({
                kind: "registry_plan_id_not_found",
                planName: entry.planName,
                worktreeId: entry.id,
                message: `Registry entry ${entry.id} references missing planId ${entry.planId}.`,
            });
        } else if (entry.planId && planIdOwners.get(entry.planId)?.name !== entry.planName) {
            // planId is the stable authority and planName is display evidence, so a
            // disagreement is provable one-directional drift: the Plan that owns the
            // id names the attempt. Rewriting the cached name touches no Git state.
            const owner = planIdOwners.get(entry.planId);
            const renamable = Boolean(owner && !owner.archived);
            issues.push({
                kind: "registry_plan_identity_mismatch",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: renamable,
                message: renamable
                    ? `Registry entry ${entry.id} stores planName ${entry.planName} but planId ${entry.planId} belongs to ${owner?.name}; --repair renames the entry to match the owning Plan.`
                    : `Registry entry ${entry.id} stores planName ${entry.planName} but planId ${entry.planId} belongs to archived Plan ${owner?.name}; restore or abandon the attempt deliberately.`,
            });
            if (repair && renamable && owner) {
                await reconcileEntryIdentity(projectRoot, entry.id, { planName: owner.name });
                repaired += 1;
            }
        }
        if (!entry.planId) {
            // Bind a legacy entry only when exactly one Plan's worktreeId names
            // this exact attempt. That back-pointer is real evidence; matching on
            // Plan name is not, and name-based migration cannot resolve an entry
            // whose cached name has drifted. Ambiguity is left for a human.
            const claimants = planResources.filter((plan) => plan.attrs.worktreeId === entry.id && plan.attrs.planId);
            const claimant = claimants.length === 1 ? claimants[0] : undefined;
            issues.push({
                kind: "registry_missing_plan_id",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: Boolean(claimant),
                message: claimant
                    ? `Registry entry ${entry.id} has no planId; --repair binds it to ${claimant.attrs.planId} (${claimant.name}) because that Plan's worktreeId already names this attempt.`
                    : claimants.length > 1
                    ? `Registry entry ${entry.id} has no planId and ${claimants.length} Plans claim this attempt; resolve the conflicting worktreeId pointers before binding it.`
                    : `Registry entry ${entry.id} for ${entry.planName} has no planId and no Plan claims this exact attempt; run load-plan or recreate the attempt to bind it safely.`,
            });
            if (repair && claimant) {
                await reconcileEntryIdentity(projectRoot, entry.id, {
                    planId: claimant.attrs.planId,
                    ...(claimant.name !== entry.planName ? { planName: claimant.name } : {}),
                });
                repaired += 1;
            }
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

export async function runPlansDoctorCommand(
    argv: string[],
    options: { __testDeps?: { parseArgs?: typeof parseArgsFn; runPlansDoctor?: typeof runPlansDoctor } } = {},
) {
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
    console.log(formatDoctorReport(result.issues, result.repaired, Boolean(parsed.repair)));
}
