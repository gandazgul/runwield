import { relative } from "@std/path";
import { getStoredPlanPath } from "../../plan-store.js";

export type ValidationRepairPromptInput = {
    planName: string;
    projectRoot: string;
    executionCwd: string;
    repairCwd: string;
    repairsNeeded: string;
    includePlanLink?: boolean;
    worktreeId?: string;
    worktreeBranch?: string;
    worktreeBaseBranch?: string;
    authorityNote?: string;
    completionInstruction?: string;
};

/**
 * Build the bounded packet for an independent validation-repair session.
 *
 * The repair Agent gets durable file references and the current failure. It does
 * not inherit the implementation transcript or receive another inline copy of the
 * Plan.
 */
export function buildValidationRepairPrompt(input: ValidationRepairPromptInput): string {
    const planPath = input.includePlanLink === false ? "" : getStoredPlanPath(input.repairCwd, input.planName);
    const planLabel = planPath ? relative(input.repairCwd, planPath).replaceAll("\\", "/") : "";
    const contextLines = [
        `- Repair checkout: \`${input.repairCwd}\``,
        ...(planPath ? [`- Approved Plan file: [${planLabel}](<${planPath}>)`] : []),
        ...(input.executionCwd !== input.repairCwd ? [`- Original execution worktree: \`${input.executionCwd}\``] : []),
        ...(input.projectRoot !== input.repairCwd ? [`- Primary project root: \`${input.projectRoot}\``] : []),
        ...(input.worktreeId ? [`- Worktree ID: \`${input.worktreeId}\``] : []),
        ...(input.worktreeBranch ? [`- Worktree branch: \`${input.worktreeBranch}\``] : []),
        ...(input.worktreeBaseBranch ? [`- Target branch: \`${input.worktreeBaseBranch}\``] : []),
    ];

    return [
        "You completed the implementation, but RunWield validation found a problem. Address the repair feedback below, verify the repair, and call task_completed again when the repair is complete.",
        "",
        "This is an independent repair session. Use the existing implementation as the starting point. Do not repeat the original implementation.",
        ...(planPath ? ["Read the Plan file only when you need its requirements or constraints."] : []),
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
        "Call task_completed with a concise bullet-point report of the repair and verification result.",
    ].join("\n");
}
