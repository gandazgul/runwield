import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ClaudeCliExecutionSession } from "./backends/claude-cli/execution-session.ts";

export interface PiExecutionSession {
    kind: "pi";
    session: AgentSession;
}

export interface ClaudeExecutionSession {
    kind: "claude-cli";
    session: ClaudeCliExecutionSession;
}

export type ExecutionSession = PiExecutionSession | ClaudeExecutionSession;

export interface ExecutionRunOptions {
    userRequest: string;
    images?: { base64: string; mimeType: string }[];
    signal?: AbortSignal;
}

export function createPiExecutionSession(session: AgentSession): PiExecutionSession {
    return { kind: "pi", session };
}

export function createClaudeExecutionSession(session: ClaudeCliExecutionSession): ClaudeExecutionSession {
    return { kind: "claude-cli", session };
}

export function getRootExecutionMessages(rootSession: ExecutionSession | AgentSession | null): AgentMessage[] {
    if (!rootSession) return [];
    if (isExecutionSession(rootSession)) {
        return rootSession.kind === "pi" ? rootSession.session.agent.state.messages : rootSession.session.getMessages();
    }
    return rootSession.agent.state.messages;
}

export function getExecutionSteeringTarget(rootSession: ExecutionSession): AgentSession | ClaudeCliExecutionSession {
    return rootSession.session;
}

export function disposeExecutionSession(rootSession: ExecutionSession): void | Promise<void> {
    return rootSession.session.dispose();
}

export function isExecutionSession(rootSession: ExecutionSession | AgentSession): rootSession is ExecutionSession {
    return "kind" in rootSession && (rootSession.kind === "pi" || rootSession.kind === "claude-cli");
}
