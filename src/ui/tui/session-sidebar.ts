import { isKeyRelease, isKeyRepeat, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
    buildSessionSidebarProjection,
    SESSION_SIDEBAR_TABS,
    sessionArtifactKindLabel,
    type SessionSidebarProjection,
    type SessionSidebarTab,
} from "../../shared/session/session-sidebar.ts";
import type { SessionArtifactReference } from "../../shared/session/file-session-store-types.ts";
import { theme } from "../theme/theme.js";

export interface TuiSessionSidebarSnapshot {
    name?: string | null;
    busy?: boolean;
    activeAgent?: string | null;
    activeModel?: { model?: string | null; provider?: string | null };
    thinkingLevel?: string | null;
    workflowContext?: {
        routingIntent?: string | null;
        planId?: string | null;
        planName?: string | null;
        parentPlan?: string | null;
    } | null;
    activeExecutionWorkflow?: {
        planName?: string | null;
        triageMeta?: { parentPlan?: string | null } | null;
    } | null;
    managed?: { generation?: number | null } | null;
    sessionStats?: {
        userMessages: number;
        assistantMessages: number;
        toolCalls: number;
        compactionCount: number;
    } | null;
    queuedMessages?: readonly { id?: string }[];
    contextUsage?: { tokens?: number | null; contextWindow?: number; percent?: number | null } | null;
    systemContextTokens?: number | null;
    artifacts?: SessionArtifactReference[];
}

export function tuiSessionSidebarProjection(snapshot: TuiSessionSidebarSnapshot): SessionSidebarProjection {
    const activeWorkflow = snapshot.activeExecutionWorkflow;
    const plan = activeWorkflow?.planName || snapshot.workflowContext?.planName || snapshot.workflowContext?.planId ||
        "";
    const epic = activeWorkflow?.planName
        ? activeWorkflow.triageMeta?.parentPlan || ""
        : snapshot.workflowContext?.parentPlan || "";
    return buildSessionSidebarProjection({
        sessionName: snapshot.name,
        sessionState: snapshot.busy ? "active" : "idle",
        activeSurface: "tui",
        activeAgent: snapshot.activeAgent,
        activeModel: snapshot.activeModel?.model,
        thinkingLevel: snapshot.thinkingLevel,
        generation: snapshot.managed?.generation,
        userMessages: snapshot.sessionStats?.userMessages,
        assistantMessages: snapshot.sessionStats?.assistantMessages,
        toolCalls: snapshot.sessionStats?.toolCalls,
        compactionCount: snapshot.sessionStats?.compactionCount,
        queuedMessages: snapshot.queuedMessages?.length,
        contextUsedTokens: snapshot.contextUsage?.tokens,
        contextWindowTokens: snapshot.contextUsage?.contextWindow,
        contextPercent: snapshot.contextUsage?.percent,
        systemContextTokens: snapshot.systemContextTokens,
        workflowPlan: plan,
        workflowEpic: epic,
        workflowIntent: snapshot.workflowContext?.routingIntent,
        artifacts: snapshot.artifacts,
    });
}

function fit(text: string, width: number): string {
    const clipped = truncateToWidth(text, Math.max(0, width));
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export function composePinnedSessionSidebar(
    mainLines: string[],
    sidebarLines: string[],
    mainWidth: number,
    terminalRows: number,
    footerLines: string[] = [],
): string[] {
    const lineCount = Math.max(mainLines.length, sidebarLines.length);
    const bodyRows = Math.max(1, terminalRows - footerLines.length);
    const viewportStart = Math.max(0, lineCount - bodyRows);
    const visibleSidebarLines = sidebarLines.slice(0, bodyRows);
    const bodyLines = Array.from({ length: lineCount }, (_, index) => {
        const sidebarLine = visibleSidebarLines[index - viewportStart] || "";
        return `${fit(mainLines[index] || "", mainWidth)} ${sidebarLine}`;
    });
    return [...bodyLines, ...footerLines];
}

export function isSessionSidebarCycleKey(data: string): boolean {
    return !isKeyRelease(data) && !isKeyRepeat(data) && matchesKey(data, Key.ctrl("]"));
}

function field(label: string, value: string, width: number): string[] {
    return [theme.fg("dim", fit(label.toUpperCase(), width)), fit(value, width)];
}

function formatTokens(tokens: number | null): string {
    return tokens === null ? "Unknown" : tokens.toLocaleString();
}

function formatShare(tokens: number | null, usedTokens: number | null): string {
    if (tokens === null) return "Unknown";
    if (usedTokens === null || usedTokens <= 0) return `~${formatTokens(tokens)}`;
    return `~${formatTokens(tokens)} · ${((tokens / usedTokens) * 100).toFixed(1)}% of used`;
}

export class TuiSessionSidebar {
    #activeTab: SessionSidebarTab = "session";
    #sessionKey = "";

    constructor(
        private readonly getSessionKey: () => string,
        private readonly getSnapshot: () => TuiSessionSidebarSnapshot | null,
    ) {}

    cycleTab(): void {
        const index = SESSION_SIDEBAR_TABS.indexOf(this.#activeTab);
        this.#activeTab = SESSION_SIDEBAR_TABS[(index + 1) % SESSION_SIDEBAR_TABS.length];
    }

    invalidate(): void {}

    render(width: number, snapshotOverride?: TuiSessionSidebarSnapshot): string[] {
        const snapshot = snapshotOverride || this.getSnapshot();
        if (!snapshot?.managed || width < 20) return [];
        const projection = tuiSessionSidebarProjection(snapshot);
        const sessionKey = this.getSessionKey();
        if (sessionKey !== this.#sessionKey) {
            this.#sessionKey = sessionKey;
            this.#activeTab = projection.defaultTab;
        }
        const inner = Math.max(1, width - 3);
        const tabLine = SESSION_SIDEBAR_TABS.map((tab) => {
            const label = tab[0].toUpperCase() + tab.slice(1);
            return tab === this.#activeTab ? theme.fg("accent", theme.bold(label)) : theme.fg("dim", label);
        }).join(" · ");
        const content = [tabLine, ""];
        if (this.#activeTab === "workflow") {
            if (projection.workflow.epic) {
                content.push(...field("Epic", projection.workflow.epic, inner));
                content.push("");
            }
            content.push(...field("Plan", projection.workflow.plan, inner));
            content.push("");
            content.push(...field("Workflow", projection.workflow.intent.replaceAll("_", " "), inner));
            if (!projection.workflow.active) {
                content.push("", theme.fg("dim", fit("No Plan workflow is active.", inner)));
            }
        } else if (this.#activeTab === "session") {
            content.push(...field("Session", projection.session.name, inner));
            const stats = projection.session.stats;
            if (stats) {
                content.push(
                    "",
                    ...field(
                        "Messages",
                        `${stats.totalMessages} · ${stats.userMessages} user / ${stats.assistantMessages} assistant`,
                        inner,
                    ),
                );
                content.push("", ...field("Tool calls", String(stats.toolCalls), inner));
                content.push(
                    "",
                    ...field(
                        "Compactions",
                        stats.compactionCount === 0 ? "None" : String(stats.compactionCount),
                        inner,
                    ),
                );
                if (stats.queuedMessages > 0) {
                    content.push("", ...field("Queued prompts", String(stats.queuedMessages), inner));
                }
            }
            const context = projection.session.context;
            if (context) {
                const percent = context.percent === null ? "" : ` · ${context.percent.toFixed(1)}%`;
                content.push(
                    "",
                    ...field(
                        "Context",
                        `${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}${percent}`,
                        inner,
                    ),
                );
                content.push(
                    "",
                    ...field("System & setup", formatShare(context.systemTokens, context.usedTokens), inner),
                );
                content.push(
                    "",
                    ...field(
                        "Conversation",
                        formatShare(context.conversationTokens, context.usedTokens),
                        inner,
                    ),
                );
            }
        } else if (projection.artifacts.length === 0) {
            content.push(theme.fg("dim", fit("No declared artifacts yet.", inner)));
        } else {
            for (const artifact of projection.artifacts.slice(-8).reverse()) {
                content.push(theme.bold(fit(artifact.title, inner)));
                content.push(
                    theme.fg("dim", fit(`${sessionArtifactKindLabel(artifact.kind)} · ${artifact.path}`, inner)),
                );
                content.push("");
            }
        }
        content.push("", theme.fg("dim", fit("ctrl+] switch tab", inner)));
        const border = theme.fg("dim", "│");
        return content.map((line) => `${border} ${fit(line, inner)}`);
    }
}
