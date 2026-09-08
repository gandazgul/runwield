import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ClaudeCliExecutionSession } from "./backends/claude-cli/execution-session.ts";
import type { AgyCliExecutionSession } from "./backends/agy-cli/execution-session.ts";

export interface PiExecutionSession {
    kind: "pi";
    session: AgentSession;
    dispose(): void;
}

export interface ClaudeExecutionSession {
    kind: "claude-cli";
    session: ClaudeCliExecutionSession;
    dispose(): void | Promise<void>;
}

export interface AgyExecutionSession {
    kind: "agy-cli";
    session: AgyCliExecutionSession;
    dispose(): Promise<void>;
}

export type ExecutionSession = PiExecutionSession | ClaudeExecutionSession | AgyExecutionSession;

export interface ExecutionRunOptions {
    userRequest: string;
    images?: { base64: string; mimeType: string }[];
    signal?: AbortSignal;
}

export function createPiExecutionSession(session: AgentSession): PiExecutionSession {
    return { kind: "pi", session, dispose: () => session.dispose() };
}

export function createClaudeExecutionSession(session: ClaudeCliExecutionSession): ClaudeExecutionSession {
    return { kind: "claude-cli", session, dispose: () => session.dispose() };
}

export function createAgyExecutionSession(session: AgyCliExecutionSession): AgyExecutionSession {
    return { kind: "agy-cli", session, dispose: () => session.dispose() };
}

export function getRootExecutionMessages(rootSession: ExecutionSession | AgentSession | null): AgentMessage[] {
    if (!rootSession) return [];
    if (isExecutionSession(rootSession)) {
        return rootSession.kind === "pi" ? rootSession.session.agent.state.messages : rootSession.session.getMessages();
    }
    return rootSession.agent.state.messages;
}

export function getExecutionSteeringTarget(
    rootSession: ExecutionSession,
): AgentSession | ClaudeCliExecutionSession | AgyCliExecutionSession {
    return rootSession.session;
}

export function disposeExecutionSession(rootSession: ExecutionSession): void | Promise<void> {
    return rootSession.dispose();
}

export function isExecutionSession(rootSession: ExecutionSession | AgentSession): rootSession is ExecutionSession {
    return "kind" in rootSession &&
        (rootSession.kind === "pi" || rootSession.kind === "claude-cli" || rootSession.kind === "agy-cli");
}
