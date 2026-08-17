import { assert, assertEquals } from "@std/assert";
import {
    buildPlanRecoveryUserMessage,
    buildValidationRecoveryNotice,
    buildValidationUserMessage,
    listPlanRecoveryMessages,
    listValidationUserMessages,
    type PlanRecoveryMessageRequest,
    validationMergeRepairMessage,
    validationPhasePauseMessage,
    type ValidationRecoveryNotice,
    validationReviewerPauseMessage,
} from "./validation-user-messages.ts";
import { doctorCheckMessage, doctorCleanMessage, doctorNeedsHelpMessage } from "../../cmd/plans/doctor-messages.ts";

const FORBIDDEN = [
    "worktree registry",
    "front matter",
    "lifecycle",
    "projection",
    "checkpoint",
    "settlement",
    "execution context",
    "delivery evidence",
    "planid",
    "worktreeid",
];

function syllables(word: string): number {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!cleaned) return 0;
    const groups = cleaned.replace(/e$/, "").match(/[aeiouy]+/g)?.length || 1;
    return Math.max(1, groups);
}

/** Flesch-Kincaid grade level after paths, code, ids, and allowed Git words are removed. */
function fleschKincaidGrade(message: string): number {
    const normalized = message
        .replace(/`[^`]*`/g, "")
        .replace(/(?:\.?\.?\/)?[\w.-]+(?:\/[\w.-]+)+/g, "")
        .replace(/\b(?:manual QA|Work Record)\b/gi, "")
        .replace(/\b(?:branch|commit|worktree|RunWield|Plan|Generating)\b/gi, "")
        .replace(/\b\w*[\d_-]\w*\b/g, "");
    const sentences = Math.max(1, (normalized.match(/[.!?]+/g) || []).length);
    const words = normalized.match(/[A-Za-z]+/g) || [];
    const syllableCount = words.reduce((sum, word) => sum + syllables(word), 0);
    return 0.39 * (words.length / sentences) + 11.8 * (syllableCount / Math.max(1, words.length)) - 15.59;
}

async function validationDisplaySources(): Promise<string[]> {
    const paths: string[] = [];
    for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
        if (entry.isFile && /^validation-.*\.(?:ts|js)$/.test(entry.name) && !entry.name.includes("test")) {
            paths.push(new URL(entry.name, import.meta.url).pathname);
        }
    }
    return paths;
}

function recoveryDisplaySources(): string[] {
    const directory = new URL("../../cmd/load-plan/", import.meta.url);
    const names = [
        "plan-recovery-actions.ts",
        "plan-recovery-flow.ts",
        "plan-recovery-merge.ts",
        "plan-recovery-reset.ts",
        "plan-recovery-worktree.ts",
    ];
    return names.map((name) => new URL(name, directory).pathname);
}

Deno.test("all validation recovery and doctor messages stay plain", async () => {
    const recoveryRequests: PlanRecoveryMessageRequest[] = [
        { kind: "manual_merge_unavailable" },
        { kind: "missing_worktree" },
        { kind: "missing_plan_pointer" },
        { kind: "missing_target" },
        { kind: "proof_failed" },
        { kind: "plan_restored", path: "docs/plans/demo.md" },
        { kind: "not_worktree" },
        { kind: "incomplete_worktree" },
        { kind: "merge_progress", sourceBranch: "work", targetBranch: "main" },
        { kind: "snapshot_restore_failed" },
        { kind: "registry_update_failed" },
        { kind: "merged" },
        { kind: "result_record_failed" },
        { kind: "conflict_state_save_failed" },
        { kind: "invalid_policy", action: "run", planName: "demo" },
        { kind: "git_blocked" },
        { kind: "recreate_warning", planName: "demo", path: "/tmp/work" },
        { kind: "worktree_abandoned", planName: "demo" },
        { kind: "worktree_path_missing", planName: "demo" },
        { kind: "worktree_missing", planName: "demo", path: "/tmp/work" },
        { kind: "worktree_branch_changed", planName: "demo" },
        { kind: "worktree_inspection_failed", planName: "demo" },
        { kind: "reset_baseline_missing" },
        { kind: "reset_done" },
        { kind: "recreate_base_missing" },
        { kind: "stopped" },
        { kind: "record_incomplete" },
        { kind: "record_restore_failed" },
        { kind: "record_restored", planName: "demo" },
        { kind: "records_settled", count: 2 },
        { kind: "record_unfinished", planName: "demo" },
        { kind: "records_attested", planName: "demo" },
        { kind: "deleting_worktree", planName: "demo" },
        { kind: "git_delete_skipped" },
        { kind: "record_already_gone" },
        { kind: "abandon_done", removed: true },
        { kind: "recovery_report", summary: "This is the Plan named demo.", lastRunStopped: false },
    ];
    const recoveryNotices: ValidationRecoveryNotice[] = [
        { kind: "session_plan_fixed", planName: "demo" },
        { kind: "worktree_record_rebuilt", planName: "demo" },
        { kind: "worktree_record_fixed", planName: "demo" },
        { kind: "worktree_path_fixed", planName: "demo" },
        { kind: "branch_restored", branch: "work" },
        { kind: "worktree_restored", planName: "demo", branch: "work" },
        { kind: "execution_plan_fixed", planName: "demo" },
        { kind: "review_range_fixed", planName: "demo" },
        { kind: "merge_plan_preserved", planName: "demo" },
    ];
    const messages = [
        ...listValidationUserMessages().map((entry) => entry.message),
        buildValidationUserMessage({ kind: "amendment_failed_prompt" }),
        buildValidationUserMessage({ kind: "amendment_prompt", summary: "The test command changed." }),
        buildValidationUserMessage({ kind: "amendment_decision", summary: "The test command changed." }),
        buildValidationUserMessage({ kind: "amendment_approved" }),
        buildValidationUserMessage({ kind: "ci_running", cwd: "/tmp/demo" }),
        buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: true }),
        buildValidationUserMessage({ kind: "checks_passed", objectiveChecks: true, waived: true }),
        buildValidationUserMessage({ kind: "repair_waiting", agent: "Engineer" }),
        buildValidationUserMessage({ kind: "engineer_follow_up", agent: "Engineer" }),
        buildValidationUserMessage({ kind: "objective_all_waived", planName: "demo" }),
        buildValidationUserMessage({
            kind: "objective_running",
            planName: "demo",
            checkIds: ["check-1"],
            skippedCount: 1,
        }),
        buildValidationUserMessage({ kind: "objective_canceled" }),
        buildValidationUserMessage({ kind: "objective_summary", summary: "One check passed." }),
        buildValidationUserMessage({ kind: "objective_report_stale" }),
        buildValidationUserMessage({
            kind: "objective_waiver_notice",
            source: "agent",
            planName: "demo",
            reason: "The check has no test file.",
        }),
        buildValidationUserMessage({
            kind: "objective_waiver_prompt",
            source: "runwield",
            planName: "demo",
            reason: "The check has no test file.",
        }),
        buildValidationUserMessage({ kind: "objective_feedback_prompt" }),
        buildValidationUserMessage({ kind: "objective_feedback_default" }),
        buildValidationUserMessage({ kind: "objective_note_prompt" }),
        buildValidationUserMessage({ kind: "objective_repair", agent: "Engineer" }),
        buildValidationUserMessage({ kind: "ci_repair", agent: "Engineer" }),
        buildValidationUserMessage({ kind: "semantic_round", round: 1, maxRounds: 3, mode: "discovery" }),
        buildValidationUserMessage({ kind: "semantic_skipped", reason: "non_git" }),
        buildValidationUserMessage({ kind: "semantic_skipped", reason: "empty_diff" }),
        buildValidationUserMessage({ kind: "semantic_approved", round: 1 }),
        buildValidationUserMessage({ kind: "review_repair", repairKind: "semantic" }),
        buildValidationUserMessage({ kind: "reviewer_nudge", round: 1, attempt: 2 }),
        buildValidationUserMessage({
            kind: "semantic_limit",
            planName: "demo",
            rounds: 3,
            openCount: 1,
            testsPass: true,
        }),
        buildValidationUserMessage({ kind: "human_review_offer" }),
        buildValidationUserMessage({ kind: "human_review_wait" }),
        buildValidationUserMessage({ kind: "human_review_prompt", planName: "demo" }),
        buildValidationUserMessage({ kind: "human_review_approved" }),
        buildValidationUserMessage({ kind: "qa_prepare", planName: "demo" }),
        buildValidationUserMessage({ kind: "qa_ready", path: "docs/qa/demo.md", existed: false }),
        buildValidationUserMessage({ kind: "merge_progress", sourceBranch: "work", targetBranch: "main" }),
        buildValidationUserMessage({ kind: "merge_dispatch", agent: "Engineer", cwd: "/tmp/demo" }),
        buildValidationUserMessage({ kind: "verified", planName: "demo" }),
        buildValidationUserMessage({ kind: "status_repaired" }),
        buildValidationUserMessage({ kind: "context_blocked", planName: "demo" }),
        buildValidationUserMessage({ kind: "validation_command_missing" }),
        buildValidationUserMessage({ kind: "validation_command_prompt" }),
        buildValidationUserMessage({ kind: "validation_command_saved", command: "deno task ci" }),
        buildValidationUserMessage({
            kind: "work_record_prompt",
            recordId: "WR-1",
            reason: "The new work takes its place.",
        }),
        buildValidationUserMessage({ kind: "work_record_notice", message: "The Work Record is saved." }),
        buildValidationUserMessage({ kind: "manual_qa_failed" }),
        buildValidationUserMessage({ kind: "manual_qa_start" }),
        buildValidationUserMessage({ kind: "work_record_start" }),
        buildValidationUserMessage({ kind: "work_record_result", status: "failed" }),
        buildValidationUserMessage({ kind: "quick_fix_start" }),
        buildValidationUserMessage({ kind: "quick_fix_running", attempt: 1, maxAttempts: 3 }),
        buildValidationUserMessage({ kind: "quick_fix_canceled" }),
        buildValidationUserMessage({ kind: "quick_fix_ci_passed" }),
        buildValidationUserMessage({ kind: "quick_fix_qa" }),
        buildValidationUserMessage({ kind: "quick_fix_passed" }),
        buildValidationUserMessage({ kind: "quick_fix_failed", maxAttempts: 3 }),
        buildValidationUserMessage({ kind: "quick_fix_repair", agent: "Engineer", attempt: 1, maxAttempts: 3 }),
        buildValidationUserMessage({ kind: "quick_fix_waiting", agent: "Engineer" }),
        buildValidationUserMessage({ kind: "recovery_repair_failed" }),
        buildValidationUserMessage({ kind: "semantic_diff_missing", planOnly: true }),
        buildValidationUserMessage({ kind: "semantic_diff_missing", planOnly: false }),
        ...recoveryRequests.map(buildPlanRecoveryUserMessage),
        ...recoveryNotices.map(buildValidationRecoveryNotice),
        buildValidationUserMessage({ kind: "user_action", whatHappened: "The check stopped.", doThis: "Try again." }),
        ...listPlanRecoveryMessages(),
        validationMergeRepairMessage("demo"),
        validationPhasePauseMessage("mechanical"),
        validationReviewerPauseMessage("demo"),
        doctorCleanMessage(0),
        doctorCleanMessage(2),
        doctorNeedsHelpMessage(1, 1),
        doctorCheckMessage(2),
    ];
    for (const message of messages) {
        const lower = message.toLowerCase();
        for (const term of FORBIDDEN) assert(!lower.includes(term), `${term} leaked in: ${message}`);
        assert(message.split(/\s+/).length <= 24, `message is too long: ${message}`);
        assert(fleschKincaidGrade(message) <= 4, `message is above grade 4: ${message}`);
    }

    // Inventory each production display edge. Text literals and raw operation
    // details must not skip the typed catalog.
    let inventoriedCalls = 0;
    for (const path of await validationDisplaySources()) {
        const source = await Deno.readTextFile(path);
        inventoriedCalls += (source.match(
            /(?:emitStatus|emitProgress|emitSystemStatus|emitRunWieldSystemStatus|appendSystemMessage)\s*\(/g,
        ) || [])
            .length;
        assertEquals(
            /(?:emitStatus|emitProgress|emitSystemStatus|emitRunWieldSystemStatus)\s*\(\s*(?:args|hostedSession)\s*,\s*[`"']/s
                .test(source),
            false,
            path,
        );
        assertEquals(
            /(?:emitStatus|emitRunWieldSystemStatus)\s*\(\s*(?:args|hostedSession)\s*,\s*(?:reason|packet\.reason|summary\.)/s
                .test(source),
            false,
            path,
        );
        assertEquals(/prompt:\s*[`"']/s.test(source), false, path);
        if (!path.endsWith("validation-emit.ts")) {
            assertEquals(/\.emitStatus\s*\(/s.test(source), false, path);
        }
    }
    assert(inventoriedCalls > 30, "the display inventory did not find production calls");

    for (const path of recoveryDisplaySources()) {
        const source = await Deno.readTextFile(path);
        const calls = source.match(/appendSystemMessage\s*\(/g) || [];
        const catalogCalls = source.match(
            /appendSystemMessage\s*\(\s*(?:buildPlanRecoveryUserMessage|buildValidationRecoveryNotice|buildValidationUserMessage|planRecoveryMessage)\s*\(/g,
        ) || [];
        assertEquals(catalogCalls.length, calls.length, path);
    }
});
