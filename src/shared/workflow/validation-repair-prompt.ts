import { relative } from "@std/path";
import { getStoredPlanPath } from "../../plan-store.js";
import { projectEngineerPlanBody } from "./engineer-plan-projection.ts";

export type ValidationRepairPromptInput = {
    planName: string;
    projectRoot: string;
    executionCwd: string;
    repairCwd: string;
    repairsNeeded: string;
    planContent?: string;
    includePlanLink?: boolean;
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
 * The repair Agent gets the parsed Plan body, durable worktree references, and
 * the current failure. It never receives Plan Front Matter.
 */
export function buildValidationRepairPrompt(input: ValidationRepairPromptInput): string {
    const planPath = input.includePlanLink === false ? "" : getStoredPlanPath(input.repairCwd, input.planName);
    const planLabel = planPath ? relative(input.repairCwd, planPath).replaceAll("\\", "/") : "";
    const planBody = input.planContent ? projectEngineerPlanBody(input.planContent) : "";
    const contextLines = [
        `- Repair checkout: \`${input.repairCwd}\``,
        ...(planPath ? [`- Approved Plan file: [${planLabel}](<${planPath}>)`] : []),
        ...(input.executionCwd !== input.repairCwd ? [`- Original execution worktree: \`${input.executionCwd}\``] : []),
        ...(input.projectRoot !== input.repairCwd ? [`- Primary project root: \`${input.projectRoot}\``] : []),
        ...(input.worktreeId ? [`- Worktree ID: \`${input.worktreeId}\``] : []),
        ...(input.worktreeBranch ? [`- Worktree branch: \`${input.worktreeBranch}\``] : []),
        ...(input.worktreeBaseBranch ? [`- Target branch: \`${input.worktreeBaseBranch}\``] : []),
        ...(input.ciStateSummary ? [`- Current CI state: ${input.ciStateSummary}`] : []),
    ];

    return [
        "You completed the implementation, but RunWield validation found a problem. Address the repair feedback below, verify the repair, and call task_completed again when the repair is complete.",
        "",
        "This is an independent repair session. Use the existing implementation as the starting point. Do not repeat the original implementation.",
        ...(planBody
            ? ["Use the approved Plan body below for requirements and constraints. Do not reread the raw Plan file; its Front Matter is orchestration metadata."]
            : []),
        ...(input.authorityNote ? ["", input.authorityNote] : []),
        "",
        "## Work Context",
        "",
        ...contextLines,
        ...(planBody ? ["", "## Approved Plan Body", "", planBody] : []),
        "",
        "## Repairs Needed",
        "",
        input.repairsNeeded.trim() || "Validation failed without a detailed error report.",
        "",
        input.completionInstruction ||
        "Call task_completed with a concise bullet-point report of the repair and verification result.",
    ].join("\n");
}
