/**
 * @module shared/attached/role-instructions
 * Attached Role Instructions: the effective Router, Planner, or implementer prompt Core returns with a
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
    "- After each call, follow `workflow.nextAction`, even when the result has no `instructions`. Follow role " +
    "instructions when present. For `plan_ready`, immediately call `start_execution` and dispatch a fresh host worker, unless consent was declined; then stop. For `return_to_host`, tell the user the outcome and continue as ordinary Claude Code.",
    "- Stay in Claude Code and the browser; use no RunWield CLI or TUI commands.",
].join("\n");

const WORKER_ADDENDUM = [
    "## Attached implementation worker — overrides Core lifecycle instructions above",
    "- You are a fresh Claude-hosted worker. All model calls belong to Claude Code.",
    "- Use only the handed-off execution directory and Plan path. Follow that Plan. Never edit, clean, stash, reset, or relocate the invoking checkout. With recorded non-Git consent, the execution directory is the current checkout.",
    "- Do not create host worktree isolation or another worktree. RunWield owns execution isolation.",
    "- Do not call any RunWield lifecycle tool, MCP operation, CLI, or TUI, including task_completed. This overrides all Core lifecycle and completion-tool instructions above.",
    "- Return a concise Markdown bullet-point implementation report to the coordinating conversation, with outcomes and verification results. The coordinator submits task_completed.message. If blocked, return the blocker; do not claim completion.",
].join("\n");

const ROLE_ADDENDUM: Record<AttachedHostRole, string> = {
    engineer: WORKER_ADDENDUM,
    "frontend-engineer": WORKER_ADDENDUM,
    router: "- Report Triage with `triage_report`. Put the Core `triage_report` arguments (`routingIntent`, " +
        "`complexity`, `summary`, `workKind`, `sessionName`) in `payload.outcome`.",
    planner: [
        "- Before you write the Plan, show the user the `workflow.nextAction.projectSetup` paths: `plan_written` " +
        "creates them in the repository. When the list is empty, nothing new is created.",
        "- Submit with `plan_written`. Put `planName`, and optionally `executionAgent` and " +
        "`collaborationRecommendation`, in `payload` next to `actionId`.",
        "- When `workflow.nextAction.kind` is `review`, show `review.url` and poll `status` with a short shell sleep " +
        "between calls while browser review is pending.",
        "- When feedback returns a Planner action, read its feedback, image paths, and note, revise the Plan, then " +
        "call `plan_written` with the new action ID and current revision. Browser edits are already saved; do not " +
        "apply them twice. The live browser page is reused for the next round.",
        "- After cancellation, tell the user that review was canceled and ask what to do next. The workflow remains " +
        "open. `/runwield:plan-review` restores the last open workflow in a fresh conversation.",
    ].join("\n"),
};

/** The effective layered instructions for one host role, ready to hand to Claude Code. */
export async function resolveAttachedRoleInstructions(projectRoot: string, role: AttachedHostRole): Promise<string> {
    const agent = await loadAgentDef(role, projectRoot);
    const bundledAgentDefsPath = await getBundledAgentDefsPath();
    return [
        agent.rolePrompt.replaceAll("{{BUNDLED_AGENT_DEFS_DIR}}", bundledAgentDefsPath),
        buildBridgedToolPromptAppendix([], "Claude Code", agent.tools).trim(),
        ...(role === "engineer" || role === "frontend-engineer" ? [] : [ENVELOPE_ADDENDUM]),
        ROLE_ADDENDUM[role],
    ].join("\n\n");
}
