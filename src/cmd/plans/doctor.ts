/**
 * @module cmd/plans/doctor
 * Report and safely repair Plan/worktree lifecycle drift.
 */

import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import {
    CLI_BIN,
    getCwd,
    getRunWieldRuntimeDir,
    isPlannedChangeClassification,
    PLAN_LOCKS_DIR_NAME,
    RUNWIELD_DIR_NAME,
    WORKTREE_BRANCH_PREFIX,
    WORKTREE_REGISTRY_FILE,
} from "../../constants.js";
import {
    getPlansDir,
    listArchivedPlans,
    listPlanResources,
    loadPlanFileStrict,
    loadPlanStrict,
} from "../../plan-store.js";
import { inspectPlanIdentityDocuments } from "../../shared/workflow/plan-diagnostic-evidence.ts";
import {
    getTransitionJournalDir,
    reconcileTransitionRecoveryRecords,
    type TransitionReconciliation,
} from "../../shared/workflow/state-transition.ts";
import {
    buildEffectProver,
    isGitAncestor,
    listGitWorktreePaths,
    runGitLines,
} from "../../shared/workflow/transition-recovery.ts";
import { isLockHolderGone, isLockHolderUnattributable } from "../../shared/process-liveness.ts";
import { doctorCheckMessage, doctorCleanMessage, doctorNeedsHelpMessage } from "./doctor-messages.ts";
import {
    inspectWorktreeRegistry,
    listEntries,
    pruneEntry,
    reconcileEntryIdentity,
} from "../../shared/worktree-registry.js";
import { isEpicArtifactPlanName } from "../../shared/epic-artifacts.ts";

/** A registry attempt as stored, before doctor proves anything about it. */
type RegistryEntry = Awaited<ReturnType<typeof inspectWorktreeRegistry>>["entries"][number];

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
    /**
     * Commands for this exact occurrence, ready to paste. Instance-specific paths
     * and ids belong here; `IssueGuidance.nextSteps` covers the general advice.
     */
    commands?: string[];
    /** What --repair did, or would do. Printed so the action is never a surprise. */
    repairSummary?: string;
}

interface IssueGuidance {
    category: string;
    severity: "Critical" | "Needs attention" | "Cleanup";
    diagnosis: string;
    nextSteps: string[];
}

type PlansDoctorCommandOptions = Record<never, never>;

const READ_ONLY_DOCTOR_FLAG = "--check";

function printHelp() {
    console.log(`Usage:
  ${CLI_BIN} plans doctor [${READ_ONLY_DOCTOR_FLAG}]

Fixes safe Plan problems. Use ${READ_ONLY_DOCTOR_FLAG} to only look. --repair is kept as an alias.`);
}

function getIssueGuidance(issue: DoctorIssue): IssueGuidance {
    switch (issue.kind) {
        case "malformed_plan":
        case "malformed_archived_plan":
        case "non_regular_plan_path":
            return {
                category: "Plan files",
                severity: "Critical",
                diagnosis:
                    "RunWield cannot parse the Front Matter block in this Plan file, so it will not touch the file at all.",
                nextSteps: [
                    "Only the YAML between the leading --- markers has to be valid. Your body text below it is yours and is never parsed, so nothing there can cause this.",
                    "RunWield left the file byte-for-byte as it found it, so a git diff shows exactly what changed.",
                    `Lifecycle commands for this Plan stay blocked until it parses; re-run ${CLI_BIN} plans doctor to confirm the fix.`,
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
        case "unresolved_transition_in_worktree":
            return {
                category: "Lifecycle transitions",
                severity: "Critical",
                diagnosis:
                    "A lifecycle operation was interrupted and RunWield cannot yet prove how it ended, so it is holding further changes to that Plan rather than stacking onto uncertain state.",
                nextSteps: [
                    "The detail line names the exact effect involved; that is the only thing worth checking.",
                    "Nothing here is lost work: the Plan, its worktree, and its branch are all untouched while the record stands.",
                    "Plan Recovery supersedes these records, so a successful recovery action clears them for you.",
                ],
            };
        case "stale_plan_lock":
            return {
                category: "Lifecycle transitions",
                severity: "Cleanup",
                diagnosis:
                    "A lock file outlived the process that created it. RunWield reclaims these on its own, but only after making the next command wait.",
                nextSteps: [
                    "Nothing is at risk: the file records only that a process was working on the Plan.",
                    "Clear it now to avoid an unexplained pause the next time you touch this Plan.",
                ],
            };
        case "registry_integrity_error":
            return {
                category: "Worktree registry",
                severity: "Critical",
                diagnosis:
                    "RunWield's own worktree registry file is unreadable, so attempt state is hidden until it is restored.",
                nextSteps: [
                    "This file is RunWield's bookkeeping, not your work: no Plan content or Git commit depends on it.",
                    "It is normally committed, so checking out the last good copy is the fastest fix; git worktree list shows what actually exists if you need to rebuild it.",
                    "Attempts RunWield forgets are still recoverable from their branches and directories, which are untouched.",
                ],
            };
        case "unsupported_schema_version":
            return {
                category: "Worktree registry",
                severity: "Critical",
                diagnosis:
                    "The worktree registry was written by a newer RunWield than the one running now, so this version must not rewrite it.",
                nextSteps: [
                    "Upgrade RunWield to the version that wrote this registry rather than downgrading the file.",
                    "Do not start, merge, or abandon attempts with this version in the meantime.",
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

function summarizeIssueSeverities(issues: DoctorIssue[]): string {
    const severityCounts = issues.reduce((counts, issue) => {
        const severity = getIssueGuidance(issue).severity;
        counts.set(severity, (counts.get(severity) || 0) + 1);
        return counts;
    }, new Map<IssueGuidance["severity"], number>());
    return ["Critical", "Needs attention", "Cleanup"].map((severity) =>
        `${severity}: ${severityCounts.get(severity as IssueGuidance["severity"]) || 0}`
    ).join(" · ");
}

function _formatDoctorReport(issues: DoctorIssue[]) {
    const byCategory = new Map<string, DoctorIssue[]>();
    for (const issue of issues) {
        const guidance = getIssueGuidance(issue);
        const categoryIssues = byCategory.get(guidance.category) || [];
        categoryIssues.push(issue);
        byCategory.set(guidance.category, categoryIssues);
    }

    const lines = [
        `[RunWield] Plans doctor diagnosis: ${issues.length} issue${issues.length === 1 ? "" : "s"} found.`,
        `Summary: ${summarizeIssueSeverities(issues)}`,
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
            if (issue.commands?.length) {
                lines.push(issue.commands.length === 1 ? "   Run:" : "   Run one of:");
                for (const command of issue.commands) lines.push(`     ${command}`);
            }
            if (issue.repairSummary) lines.push(`   Repair: ${issue.repairSummary}`);
            else if (issue.repairable) lines.push("   Repair: Safe automated repair is available with --repair.");
            lines.push("");
        });
    }

    if (issues.some((issue) => issue.repairable)) {
        lines.push(
            `[RunWield] Some of this is safe for RunWield to fix by itself. Run: ${CLI_BIN} plans doctor --repair`,
        );
    }
    return lines.join("\n").trimEnd();
}

function _formatDoctorRepairReport(repaired: number, remainingIssues: DoctorIssue[]): string {
    const lines = [
        `[RunWield] Applied ${repaired} safe repair${repaired === 1 ? "" : "s"}.`,
        `[RunWield] ${remainingIssues.length} problem${remainingIssues.length === 1 ? " remains" : "s remain"}.`,
    ];
    if (remainingIssues.length > 0) {
        lines.push(`Summary: ${summarizeIssueSeverities(remainingIssues)}`);
    }
    lines.push(`For the full diagnosis, run: ${CLI_BIN} plans doctor`);
    return lines.join("\n");
}

async function collectPlanIssues(
    projectRoot: string,
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
                    await collectPlanIssues(projectRoot, root, [...prefix, entry.name], issues, planIds);
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
            if (isEpicArtifactPlanName(planName)) continue;
            const result = await loadPlanStrict(projectRoot, planName);
            if (result.kind === "malformed") {
                issues.push({
                    kind: "malformed_plan",
                    planName,
                    message: result.error.message,
                    commands: [`git diff -- ${entryPath}`, `git checkout -- ${entryPath}`],
                });
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
    if (plan.attrs.status === "verified" && isPlannedChangeClassification(plan.attrs.classification)) {
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
                if (isEpicArtifactPlanName(planName)) continue;
                try {
                    const parsed = await loadPlanFileStrict(entryPath);
                    if (parsed.kind !== "loaded") {
                        if (parsed.kind === "malformed") throw parsed.error;
                        throw new Error("Archived Plan could not be read.");
                    }
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
 * Turn one unresolved journal into something a person can act on.
 *
 * The record is RunWield's own bookkeeping, so "unresolved_transition
 * 4f2a-…: worktree_registry_updated" is not a report, it is a receipt for a
 * problem the user did not cause. Name the Plan, say which effect lacks evidence
 * and why, and give the commands that either resolve it or show them what to look
 * at — including, as the last resort, the exact file to delete once they have
 * decided.
 */
function capitalize(text: string): string {
    return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function describeUnresolvedTransition(reconciliation: TransitionReconciliation): DoctorIssue {
    const unproven = (reconciliation.effects || []).filter((effect) => effect.verdict && !effect.verdict.settled);
    const commands: string[] = [];
    if (reconciliation.resolvable) {
        // Nothing to investigate: --repair is the whole answer, so anything else here
        // is noise that makes a solved problem look like a decision.
        commands.push(`${CLI_BIN} plans doctor --repair`);
    } else {
        if (reconciliation.planName) commands.push(`${CLI_BIN} load-plan ${reconciliation.planName}`);
        for (const action of reconciliation.recoveryActions || []) {
            if (action.command && !commands.includes(action.command)) commands.push(action.command);
        }
        for (const effect of unproven) {
            const proof = (effect.proof || {}) as Record<string, unknown>;
            if (typeof proof.path === "string") commands.push(`git -C ${proof.path} status --short`);
            if (typeof proof.targetBranch === "string" && typeof proof.sealedExecutionCommit === "string") {
                commands.push(`git branch --contains ${proof.sealedExecutionCommit}`);
                commands.push(`git log --oneline ${proof.targetBranch} -5`);
            }
        }
        // Listed last and only here: deleting the record is the escape hatch for a user
        // who has checked the state themselves, not a first move.
        if (reconciliation.path) {
            commands.push(`cat ${reconciliation.path}`);
            commands.push(`rm ${reconciliation.path}`);
        }
    }
    const detail = reconciliation.resolvable
        ? `Everything it recorded is accounted for: ${reconciliation.reason}.`
        : unproven.length > 0
        // Already effect-prefixed by reconciliation, so it reads as a clause.
        ? `Waiting on ${reconciliation.reason}.`
        : `${capitalize(reconciliation.reason)}.`;
    return {
        kind: "unresolved_transition",
        planName: reconciliation.planName,
        repairable: reconciliation.resolvable,
        message: `${reconciliation.operation || "A lifecycle operation"} on ${
            reconciliation.planName || "an unnamed Plan"
        } stopped at "${
            reconciliation.state || "needs_recovery"
        }" before RunWield could confirm the outcome. ${detail}`,
        commands: [...new Set(commands)],
        repairSummary: reconciliation.resolvable
            ? "--repair closes this record; the repository already proves it is finished."
            : "Left in place on purpose: closing it without proof could hide unpublished or unsaved work. " +
                "Resolve it through load-plan, or delete the record above once you have confirmed the state yourself.",
    };
}

/**
 * Journals written inside an execution worktree.
 *
 * Some retry paths run their transaction with the worktree as the project root, so
 * their records land in the worktree's own `.wld/`. Nothing else looks there:
 * `plans doctor` scans the primary checkout, so such a record is invisible while
 * still blocking the retry that would clear it. Surfacing them is the difference
 * between "retry does nothing, no idea why" and a named file.
 */
async function collectWorktreeJournalIssues(
    projectRoot: string,
    entries: RegistryEntry[],
    repair: boolean,
): Promise<Array<{ issue?: DoctorIssue; repaired?: boolean }>> {
    const results: Array<{ issue?: DoctorIssue; repaired?: boolean }> = [];
    for (const entry of entries) {
        if (entry.path === projectRoot) continue;
        const journalDir = getTransitionJournalDir(entry.path);
        if (!(await Deno.stat(journalDir).then((stat) => stat.isDirectory).catch(() => false))) continue;
        const reconciliations = await reconcileTransitionRecoveryRecords(entry.path, { apply: repair }).catch(() => []);
        for (const reconciliation of reconciliations) {
            if (reconciliation.resolved) {
                results.push({ repaired: true });
                continue;
            }
            const issue = describeUnresolvedTransition(reconciliation);
            results.push({
                issue: {
                    ...issue,
                    kind: "unresolved_transition_in_worktree",
                    worktreeId: entry.id,
                    message:
                        `${issue.message} This record lives inside the execution worktree at ${entry.path}, so it blocks retries that run there.`,
                },
            });
        }
    }
    return results;
}

/**
 * Plan lock files left behind by a process that died holding one.
 *
 * A live lock is heartbeat-refreshed, so an untouched one is either abandoned or
 * about to be reclaimed automatically. The automatic path costs the next command a
 * long wait first, and its timeout message is a raw lock path, so reporting and
 * clearing these is strictly kinder than letting them expire. Deleting an
 * abandoned lock file destroys nothing: RunWield owns the file, and it holds no
 * state beyond "someone was here".
 */
async function collectStalePlanLockIssues(
    projectRoot: string,
    repair: boolean,
): Promise<Array<{ issue?: DoctorIssue; repaired?: boolean }>> {
    const lockDir = join(getRunWieldRuntimeDir(projectRoot), PLAN_LOCKS_DIR_NAME);
    const STALE_AFTER_MS = 10 * 60_000;
    const results: Array<{ issue?: DoctorIssue; repaired?: boolean }> = [];
    try {
        for await (const entry of Deno.readDir(lockDir)) {
            if (!entry.isFile || !entry.name.endsWith(".lock")) continue;
            const path = join(lockDir, entry.name);
            const stat = await Deno.stat(path).catch(() => null);
            const ageMs = stat?.mtime ? Date.now() - stat.mtime.getTime() : Number.POSITIVE_INFINITY;
            // A lock whose process is gone is abandoned no matter how recent it is.
            // Waiting for it to look old enough is what leaves a Plan unusable after a
            // crash, which is the case this check exists for.
            const contents = await Deno.readTextFile(path).catch(() => "");
            const holderGone = await isLockHolderGone(contents);
            // An unattributable lock names no process to check, so it can never prove
            // itself dead. Explicit repair is the only thing that clears it.
            const unattributable = isLockHolderUnattributable(contents);
            if (!holderGone && !unattributable && ageMs < STALE_AFTER_MS) continue;
            if (repair) {
                await Deno.remove(path).catch(() => {});
                results.push({ repaired: true });
                continue;
            }
            results.push({
                issue: {
                    kind: "stale_plan_lock",
                    repairable: true,
                    message: unattributable
                        ? `Plan lock ${path} records no process that can be checked, so nothing will ever release it automatically. It predates holder tracking or was truncated by a crash.`
                        : holderGone
                        ? `Plan lock ${path} was left by a RunWield process that is no longer running. Operations on that Plan reclaim it automatically now, so this is leftover cleanup.`
                        : `Plan lock ${path} has not been refreshed in ${
                            Math.round(ageMs / 60_000)
                        } minutes, so the process that held it is gone. Until it is cleared, operations on that Plan wait before failing.`,
                    commands: [`${CLI_BIN} plans doctor --repair`, `rm ${path}`],
                    repairSummary: "--repair deletes the abandoned lock file. No Plan or Git state is touched.",
                },
            });
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return results;
}

async function runPlansDoctorPass(projectRoot: string, repair: boolean) {
    const issues: DoctorIssue[] = [];
    let repaired = 0;

    // Abandoned locks are cleared before anything else, because much of the scan
    // below acquires those same locks. Diagnosing lock trouble after taking a lock
    // means doctor waits on the exact file it exists to clean up — the one command
    // the user was told to run would be the one that hangs.
    for (const lockIssue of await collectStalePlanLockIssues(projectRoot, repair)) {
        if (lockIssue.repaired) repaired += 1;
        else if (lockIssue.issue) issues.push(lockIssue.issue);
    }

    const discoveredPlanIds = new Map<string, string>();
    await collectPlanIssues(projectRoot, getPlansDir(projectRoot), [], issues, discoveredPlanIds);
    await collectArchivedPlanParseIssues(projectRoot, issues, discoveredPlanIds);

    // Read the registry without enforcing invariants first. A violated invariant
    // must not blind the report: the per-entry facts below are what the user needs
    // in order to act, and they are exactly what a throwing read would discard.
    const inspection = await inspectWorktreeRegistry(projectRoot);
    const gitWorktreePaths = await listGitWorktreePaths(projectRoot);
    if (inspection.readError) {
        issues.push({
            kind: "registry_integrity_error",
            message: `Worktree registry file could not be read: ${inspection.readError.message}`,
            commands: [
                `git diff -- ${join(RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_FILE)}`,
                `git checkout -- ${join(RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_FILE)}`,
                "git worktree list --porcelain",
            ],
        });
    }
    for (const integrityIssue of inspection.integrityIssues) {
        issues.push({
            kind: integrityIssue.kind,
            message: integrityIssue.message,
            worktreeId: integrityIssue.ids[0],
            commands: [
                ...integrityIssue.ids.map((id) => {
                    const entry = inspection.entries.find((candidate) => candidate.id === id);
                    return entry ? `git -C ${entry.path} status --short` : `git worktree list --porcelain`;
                }),
                `${CLI_BIN} load-plan ${
                    inspection.entries.find((entry) => integrityIssue.ids.includes(entry.id))?.planName || "<plan>"
                }`,
            ],
        });
    }
    const entries = inspection.entries;

    // Retire the journals whose records repository facts prove are finished. Until
    // one is cleared it blocks every later transition on its Plan, so leaving a
    // provably-settled record in place would strand the Plan over RunWield's own
    // bookkeeping.
    const proveEffect = buildEffectProver(projectRoot, { registryEntries: entries, gitWorktreePaths });
    const reconciliations = await reconcileTransitionRecoveryRecords(projectRoot, { apply: repair, proveEffect });
    for (const reconciliation of reconciliations) {
        if (reconciliation.resolved) {
            repaired += 1;
            continue;
        }
        issues.push(describeUnresolvedTransition(reconciliation));
    }
    for (const worktreeJournal of await collectWorktreeJournalIssues(projectRoot, entries, repair)) {
        if (worktreeJournal.repaired) repaired += 1;
        else if (worktreeJournal.issue) issues.push(worktreeJournal.issue);
    }
    if (repair && inspection.integrityIssues.length === 0 && !inspection.readError) {
        // Persist the v1→v2 migration only once the file is known to be consistent;
        // migrating around a conflict is how a readable registry becomes unreadable.
        await listEntries(projectRoot, { migrate: true }).catch(() => []);
    }
    const registryPaths = new Set(entries.map((entry) => entry.path));
    for (const path of gitWorktreePaths) {
        if (path !== projectRoot && !registryPaths.has(path)) {
            issues.push({
                kind: "orphan_git_worktree",
                message:
                    `Git has a worktree at ${path} that no RunWield attempt claims. It may be yours, or the remains of an attempt RunWield lost track of.`,
                commands: [
                    `git -C ${path} status --short`,
                    `git -C ${path} log --oneline -5`,
                    `git worktree remove ${path}`,
                ],
                repairSummary:
                    "Never removed automatically: an unclaimed worktree is the one place uncommitted work can be hiding. " +
                    "The status command above tells you whether anything is there.",
            });
        }
    }
    const registryBranches = new Set(entries.map((entry) => entry.branch).filter(Boolean));
    for (
        const branch of await runGitLines(projectRoot, [
            "for-each-ref",
            "--format=%(refname:short)",
            `refs/heads/${WORKTREE_BRANCH_PREFIX}`,
        ])
    ) {
        if (!registryBranches.has(branch)) {
            issues.push({
                kind: "orphan_worktree_branch",
                message:
                    `Branch ${branch} was created by RunWield for an execution attempt that is no longer in the registry.`,
                commands: [
                    `git log --oneline ${branch} -10`,
                    `git branch --contains ${branch}`,
                    `git branch -d ${branch}`,
                ],
                repairSummary:
                    "Never deleted automatically. `git branch -d` (lower-case d) refuses to delete unmerged work, " +
                    "so it is the safe way to clear this once you have looked at the log.",
            });
        }
    }

    const planResources = await listPlanResources(projectRoot, { backfillMissing: repair }).catch(() => []);
    const identityDocuments = await inspectPlanIdentityDocuments(projectRoot, entries);
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
                        `${plan.name} records that ${evidence.executionCommit} was published to ${evidence.targetBranch}, but that commit is not contained in that branch today. Either the publication never completed, or the branch was rewritten afterwards.`,
                    commands: [
                        `git log --oneline ${evidence.targetBranch} -10`,
                        `git branch --contains ${evidence.executionCommit}`,
                        `git show --stat ${evidence.executionCommit}`,
                    ],
                    repairSummary:
                        "Not repaired automatically: RunWield will not move a branch or rewrite Delivery Evidence on your behalf. " +
                        "If the commit exists on another branch, the work is safe and only the target needs updating.",
                });
            }
        }
    }
    // Archived Plans keep their planId and can still own a recoverable attempt,
    // so resolving ids from active Plans alone reports a healthy archived attempt
    // as a dangling reference. Track both, and remember which is which.
    const planIdOwners = new Map<string, { name: string; archived: boolean }>();
    for (const plan of identityDocuments) {
        if (!plan.attrs.planId) continue;
        const owners = identityDocuments.filter((candidate) => candidate.attrs.planId === plan.attrs.planId);
        if (owners.length === 1) planIdOwners.set(plan.attrs.planId, { name: plan.name, archived: false });
    }
    for (const plan of archivedPlans) {
        const planId = (plan.attrs as { planId?: unknown }).planId;
        if (typeof planId === "string" && !planIdOwners.has(planId)) {
            planIdOwners.set(planId, { name: plan.name, archived: true });
        }
    }
    const activeByPlan = new Map();
    for (const entry of entries) {
        // Attempts whose planId is set are checked by inspectWorktreeRegistry, which
        // sees the whole file at once. Only the legacy shape — a live attempt with no
        // stable id — needs a name-keyed check here, and only that shape is reported,
        // so a conflict is never listed twice.
        if (!entry.planId && entry.status !== "abandoned") {
            const prior = activeByPlan.get(entry.planName);
            if (prior) {
                issues.push({
                    kind: "duplicate_live_attempt",
                    planName: entry.planName,
                    worktreeId: entry.id,
                    message:
                        `Plan ${entry.planName} has two unfinished attempts recorded under its name with no stable id: ${prior} and ${entry.id}. RunWield will not guess which one is current.`,
                    commands: [
                        `git -C ${entry.path} status --short`,
                        `${CLI_BIN} load-plan ${entry.planName}`,
                    ],
                });
            } else {
                activeByPlan.set(entry.planName, entry.id);
            }
        }
        if (entry.planId && !planIdOwners.has(entry.planId)) {
            issues.push({
                kind: "registry_plan_id_not_found",
                planName: entry.planName,
                worktreeId: entry.id,
                message:
                    `Registry attempt ${entry.id} belongs to planId ${entry.planId}, but no Plan (active or archived) carries that id — the Plan file was probably renamed or deleted outside RunWield.`,
                commands: [
                    `grep -rl "${entry.planId}" docs/plans/`,
                    `git -C ${entry.path} status --short`,
                    `git log --oneline ${entry.branch} -5`,
                ],
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
                    ? `Registry attempt ${entry.id} still calls its Plan ${entry.planName}, but planId ${entry.planId} belongs to ${owner?.name} — the Plan was renamed.`
                    : `Registry attempt ${entry.id} still calls its Plan ${entry.planName}, but planId ${entry.planId} belongs to archived Plan ${owner?.name}.`,
                commands: renamable
                    ? [`${CLI_BIN} plans doctor --repair`]
                    : [`${CLI_BIN} plans restore ${owner?.name}`, `${CLI_BIN} load-plan ${owner?.name}`],
                repairSummary: renamable
                    ? `--repair updates the cached name to ${owner?.name}. Nothing else changes: planId is the authority, and no path, branch, or Git state is touched.`
                    : "Restore the archived Plan before touching the attempt, so the attempt has an owner that can resolve it.",
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
            const claimants = identityDocuments.filter((plan) =>
                plan.attrs.worktreeId === entry.id && plan.attrs.planId
            );
            const claimant = claimants.length === 1 ? claimants[0] : undefined;
            issues.push({
                kind: "registry_missing_plan_id",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: Boolean(claimant),
                message: claimant
                    ? `Registry attempt ${entry.id} predates stable Plan ids, and Plan ${claimant.name} already points at this exact attempt.`
                    : claimants.length > 1
                    ? `Registry attempt ${entry.id} predates stable Plan ids and ${claimants.length} Plans claim it: ${
                        claimants.map((plan) => plan.name).join(", ")
                    }. Only one Plan can own an attempt.`
                    : `Registry attempt ${entry.id} predates stable Plan ids and no Plan points at it, so RunWield cannot tell which Plan it belongs to.`,
                commands: claimant ? [`${CLI_BIN} plans doctor --repair`] : [
                    `git -C ${entry.path} status --short`,
                    `git log --oneline ${entry.branch} -5`,
                    `grep -rln "worktreeId: \\"${entry.id}\\"" docs/plans/`,
                ],
                repairSummary: claimant
                    ? `--repair records planId ${claimant.attrs.planId} on the attempt. That is a metadata write only; the worktree, branch, and Plan file are untouched.`
                    : claimants.length > 1
                    ? "Remove the stale worktreeId from whichever Plan does not own this attempt, then re-run --repair."
                    : "Inspect the branch above. If it holds work you want, resolve it through load-plan; if not, the attempt can be abandoned there.",
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
            const safelyPrunable = entry.status === "abandoned" || entry.publication?.phase === "cleanup_complete";
            issues.push({
                kind: "missing_worktree_path",
                planName: entry.planName,
                worktreeId: entry.id,
                repairable: safelyPrunable,
                message: safelyPrunable
                    ? `Registry attempt ${entry.id} points at ${entry.path}, which no longer exists. Its cleanup is already settled, so this is leftover bookkeeping.`
                    : `Registry attempt ${entry.id} is ${entry.status} but its worktree ${entry.path} is gone, so RunWield cannot reach the work it recorded.`,
                commands: safelyPrunable ? [`${CLI_BIN} plans doctor --repair`] : [
                    `git log --oneline ${entry.branch} -10`,
                    `git worktree list --porcelain`,
                    `${CLI_BIN} load-plan ${entry.planName}`,
                ],
                repairSummary: safelyPrunable
                    ? "--repair drops the registry row. The attempt was already settled, so no work can be lost."
                    : `The branch ${entry.branch} still holds any committed work from this attempt — check it before abandoning. ` +
                        "If the directory was deleted but the branch is intact, load-plan can merge or recreate from it.",
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

export async function runPlansDoctor(projectRoot: string, repair = true) {
    if (!repair) return await runPlansDoctorPass(projectRoot, false);
    let repaired = 0;
    let lastIssueKey = "";
    for (let pass = 0; pass < 8; pass += 1) {
        const result = await runPlansDoctorPass(projectRoot, true);
        repaired += result.repaired;
        const remaining = await runPlansDoctorPass(projectRoot, false);
        if (remaining.issues.length === 0) return { issues: [], repaired };
        const issueKey = remaining.issues.map((issue) =>
            `${issue.kind}:${issue.planName || ""}:${issue.worktreeId || ""}`
        ).sort().join("|");
        if (result.repaired === 0 || issueKey === lastIssueKey) return { issues: remaining.issues, repaired };
        lastIssueKey = issueKey;
    }
    const remaining = await runPlansDoctorPass(projectRoot, false);
    return { issues: remaining.issues, repaired };
}

export async function runPlansDoctorCommand(
    argv: string[],
    _options: PlansDoctorCommandOptions = {},
) {
    const parsed = parseArgs(argv, { boolean: ["help", "repair", "check"], alias: { h: "help" } });
    if (parsed.help) {
        printHelp();
        return;
    }
    const checkOnly = Boolean(parsed.check);
    const projectRoot = getCwd();
    const result = await runPlansDoctor(projectRoot, !checkOnly);
    if (checkOnly) {
        console.log(
            result.issues.length === 0
                ? doctorCheckMessage(result.issues.length)
                : `${_formatDoctorReport(result.issues)}\n[RunWield] No files changed.`,
        );
        return;
    }
    console.log(
        result.issues.length === 0
            ? doctorCleanMessage(result.repaired)
            : doctorNeedsHelpMessage(result.repaired, result.issues.length),
    );
}
