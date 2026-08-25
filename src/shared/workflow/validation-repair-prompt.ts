export type ValidationRepairPromptInput = {
    executionCwd: string;
    repairCwd: string;
    repairsNeeded: string;
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    authorityNote?: string;
    completionInstruction?: string;
    ciStateSummary?: string;
};

/**
 * Build the bounded packet for an independent validation-repair session.
 *
 * The repair Agent gets only repair-scoped checkout facts and the current
 * failure. It never receives the Plan or the general Engineer prompt.
 */
export function buildValidationRepairPrompt(input: ValidationRepairPromptInput): string {
    const contextLines = [
        `- Repair checkout: \`${input.repairCwd}\``,
        ...(input.executionCwd !== input.repairCwd ? [`- Original execution worktree: \`${input.executionCwd}\``] : []),
        ...(input.worktreeId ? [`- Worktree ID: \`${input.worktreeId}\``] : []),
        ...(input.worktreeBranch ? [`- Worktree branch: \`${input.worktreeBranch}\``] : []),
        ...(input.worktreeBaseBranch ? [`- Target branch: \`${input.worktreeBaseBranch}\``] : []),
        ...(input.ciStateSummary ? [`- Current CI state: ${input.ciStateSummary}`] : []),
    ];

    return [
        "RunWield validation found a problem. Address only the repair context below, verify the repair, and call task_completed when the repair is complete.",
        "",
        "If something blocks the repair and leaves any supplied item open, do not call task_completed. Finish what you can, then end your turn in plain text: what you fixed, which item is blocked, what stopped you, and what would unblock it. Validation pauses there and the user decides; a completion signal over an unfinished repair sends the loop back around a problem it cannot solve.",
        "",
        "This is a focused repair session. Use the existing implementation as the starting point. Do not repeat the original implementation, broaden the task, or infer requirements outside the supplied repair context.",
        ...(input.authorityNote ? ["", input.authorityNote] : []),
        "",
        "## Work Context",
        "",
        ...contextLines,
        "",
        "## Repairs Needed",
        "",
        input.repairsNeeded.trim() || "Validation failed without a detailed error report.",
        "",
        input.completionInstruction ||
        "When the repair is complete, call task_completed with a concise bullet-point report of the repair and verification result.",
    ].join("\n");
}
