/**
 * Plain user messages for validation and recovery.
 * Raw errors belong in logs, not in these messages.
 */

export type ValidationUserMessageKey =
    | "running_tests"
    | "plan_fixed"
    | "amendment_check_failed"
    | "publication_note_failed"
    | "merge_failed"
    | "retry_pause"
    | "already_running"
    | "lost_attempt";

const MESSAGES: Record<ValidationUserMessageKey, string> = {
    running_tests: "Running the tests now.",
    plan_fixed: "The Plan copy is fixed. We will go on.",
    amendment_check_failed: "RunWield could not check the Plan change. Your work is safe. Try again.",
    publication_note_failed: "The checks passed. RunWield could not save the test note. Your work is safe. Try again.",
    merge_failed: "The merge did not work. Your work is safe. RunWield will try to fix it.",
    retry_pause: "The check stopped. Your work is safe. Try again.",
    already_running: "The check is still on.",
    lost_attempt: "The worktree and branch are gone. The Plan says they should be here. What do you want to do?",
};

export function validationUserMessage(key: ValidationUserMessageKey): string {
    return MESSAGES[key];
}

export function listValidationUserMessages(): ReadonlyArray<{ key: ValidationUserMessageKey; message: string }> {
    return Object.entries(MESSAGES).map(([key, message]) => ({ key: key as ValidationUserMessageKey, message }));
}
