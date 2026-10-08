/**
 * @module shared/attached/role-instructions
 * Attached Role Instructions: the effective Router or Planner prompt Core returns with a
 * pending host action.
 *
 * The text is resolved on every response from the project, home, and bundled agent
 * definitions, so a project override applies to the next response with no other step.
 * Nothing here is saved or copied into the host.
 */

import { getBundledAgentDefsPath } from "../session/agent-assets.ts";
import { loadAgentDef } from "../session/agents.js";
import { buildBridgedToolPromptAppendix } from "../session/bridged-tools/prompt.ts";
import type { AttachedHostRole } from "./operations.ts";

const ENVELOPE_ADDENDUM = [
    "## RunWield in Claude Code",
    "",
    "You play this RunWield role inside Claude Code. Claude Code makes every model call; RunWield Core records the " +
    "workflow state.",
    "",
    "- Some tools named above exist only in RunWield (for example `code_search`, `memory`, `user_interview`, " +
    "`background_task`, and `work_record_search`). Use Claude Code's own tools for the same work, and ask the user " +
    "questions in plain text.",
    "- Call RunWield lifecycle tools through the RunWield MCP server. Each call wraps the Core arguments in an envelope:",
    "  - `operationId`: a new unique identifier for each new call. Reuse it only to retry a call that returned no result.",
    "  - `workflowId`: `workflow.workflowId` from the last RunWield result.",
    "  - `expectedRevision`: `workflow.revision` from the last RunWield result.",
    "  - `payload.actionId`: `workflow.nextAction.actionId` from the last RunWield result.",
    "- After each call, follow `workflow.nextAction` and the `instructions` in the result. A result without " +
    "`instructions` ends the RunWield role: tell the user the outcome and continue as ordinary Claude Code.",
].join("\n");

const ROLE_ADDENDUM: Record<AttachedHostRole, string> = {
    router: "- Report Triage with `triage_report`. Put the Core `triage_report` arguments (`routingIntent`, " +
        "`complexity`, `summary`, `workKind`, `sessionName`) in `payload.outcome`.",
    planner: [
        "- Before you write the Plan, show the user the `workflow.nextAction.projectSetup` paths: `plan_written` " +
        "creates them in the repository. When the list is empty, nothing new is created.",
        "- Submit with `plan_written`. Put `planName`, and optionally `executionAgent` and " +
        "`collaborationRecommendation`, in `payload` next to `actionId`.",
        "- Plan review in the browser is not available in Claude Code yet. After `plan_written` succeeds, tell the " +
        "user the Plan path and that `wld` can open and run it.",
    ].join("\n"),
};

/** The effective layered instructions for one host role, ready to hand to Claude Code. */
export async function resolveAttachedRoleInstructions(projectRoot: string, role: AttachedHostRole): Promise<string> {
    const agent = await loadAgentDef(role, projectRoot);
    const bundledAgentDefsPath = await getBundledAgentDefsPath();
    return [
        agent.rolePrompt.replaceAll("{{BUNDLED_AGENT_DEFS_DIR}}", bundledAgentDefsPath),
        buildBridgedToolPromptAppendix([], "Claude Code", agent.tools).trim(),
        ENVELOPE_ADDENDUM,
        ROLE_ADDENDUM[role],
    ].join("\n\n");
}
