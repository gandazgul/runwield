import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
    workflowContext?: { routingIntent?: string | null; planId?: string | null; planName?: string | null } | null;
    managed?: { generation?: number | null } | null;
    artifacts?: SessionArtifactReference[];
}

export function tuiSessionSidebarProjection(snapshot: TuiSessionSidebarSnapshot): SessionSidebarProjection {
    const plan = snapshot.workflowContext?.planName || snapshot.workflowContext?.planId || "";
    return buildSessionSidebarProjection({
        sessionName: snapshot.name,
        sessionState: snapshot.busy ? "active" : "idle",
        activeSurface: "tui",
        activeAgent: snapshot.activeAgent,
        activeModel: snapshot.activeModel?.model,
        thinkingLevel: snapshot.thinkingLevel,
        generation: snapshot.managed?.generation,
        workflowPlan: plan,
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
): string[] {
    const lineCount = Math.max(mainLines.length, sidebarLines.length);
    const viewportStart = Math.max(0, lineCount - Math.max(1, terminalRows));
    const visibleSidebarLines = sidebarLines.slice(0, Math.max(1, terminalRows));
    return Array.from({ length: lineCount }, (_, index) => {
        const sidebarLine = visibleSidebarLines[index - viewportStart] || "";
        return `${fit(mainLines[index] || "", mainWidth)} ${sidebarLine}`;
    });
}

function field(label: string, value: string, width: number): string[] {
    return [theme.fg("dim", fit(label.toUpperCase(), width)), fit(value, width)];
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
            content.push(...field("Plan", projection.workflow.plan, inner));
            content.push("");
            content.push(...field("Workflow", projection.workflow.intent.replaceAll("_", " "), inner));
            if (!projection.workflow.active) {
                content.push("", theme.fg("dim", fit("No Plan workflow is active.", inner)));
            }
        } else if (this.#activeTab === "session") {
            content.push(...field("Session", projection.session.name, inner));
            content.push("", ...field("State", projection.session.state, inner));
            content.push("", ...field("Agent", projection.session.agent, inner));
            content.push("", ...field("Model", projection.session.model, inner));
            content.push("", ...field("Thinking", projection.session.thinkingLevel, inner));
            content.push("", ...field("Generation", projection.session.generation, inner));
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
