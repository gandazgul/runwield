import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ToolCall, validateToolArguments } from "@earendil-works/pi-ai";
import type { IsolatedAgentSessionOptions } from "../shared/workflow/validation-session-adapter.ts";
import { createTaskCompletedTool } from "../tools/task-completed.ts";
import { createReviewCompletedTool } from "../tools/review-complete.ts";

export type WorkflowTestToolCall = {
    name: string;
    arguments: ToolCall["arguments"];
};
type CoreToolExecute = (id: string, args: WorkflowTestToolCall["arguments"]) => ReturnType<ToolDefinition["execute"]>;

/** Fake only Agent decisions; execute the production tools and their acceptance checks. */
export async function executeWorkflowTestTools(
    options: IsolatedAgentSessionOptions,
    calls: WorkflowTestToolCall[],
): Promise<void> {
    const owner = {
        sessionManager: options.sessionManager || SessionManager.inMemory(options.cwd),
        abort() {},
        dispose() {},
    };
    const token = options.hostedSession.pushSteeringTargetSession(owner);
    const tools: ToolDefinition[] = [
        ...(options.customTools || []),
        createTaskCompletedTool({ hostedSession: options.hostedSession, agentName: options.agentName }),
        createReviewCompletedTool({ hostedSession: options.hostedSession, agentName: options.agentName }),
    ];
    try {
        for (const call of calls) {
            const tool = tools.find((candidate) => candidate.name === call.name);
            if (!tool) throw new Error(`Test requested unavailable tool ${call.name}`);
            const id = crypto.randomUUID();
            const arguments_ = validateToolArguments(tool, {
                type: "toolCall",
                id,
                name: call.name,
                arguments: call.arguments,
            });
            // Core defineTool implementations do not use Pi extension context.
            await (tool.execute as CoreToolExecute)(id, arguments_);
        }
    } finally {
        options.hostedSession.popSteeringTargetSession(token);
    }
}
