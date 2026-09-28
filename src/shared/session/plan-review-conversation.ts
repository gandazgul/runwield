import { RuntimeEventTypes } from "./session-runtime-events.js";
import type { HostedRuntimeEventObservation } from "./hosted-session.js";

export interface PlanReviewConversationEvent {
    type: "assistant_text_delta";
    delta: string;
    messageId: string;
    agentName: string;
}

export interface PlanReviewConversation {
    id: string;
    agentLabel: string;
    revision: number;
    events: PlanReviewConversationEvent[];
}

function planningAgentLabel(agentName: string): string {
    return agentName.trim().split(/[-_\s]+/).filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
        .join(" ") || "Planner";
}

/** One session-owned conversation per container Plan identity, across review rounds. */
export class PlanReviewConversationOwner {
    private readonly conversations = new Map<string, PlanReviewConversation>();
    private activePlanId: string | null = null;
    private activeAgentName: string | null = null;
    private disposed = false;

    capture(event: HostedRuntimeEventObservation): void {
        if (
            this.disposed || !this.activePlanId || event.type !== RuntimeEventTypes.ASSISTANT_TEXT_DELTA ||
            typeof event.delta !== "string" || typeof event.messageId !== "string" ||
            event.agentName?.toLowerCase() !== this.activeAgentName
        ) return;
        const conversation = this.conversations.get(this.activePlanId);
        if (!conversation) return;
        conversation.events.push({
            type: "assistant_text_delta",
            delta: event.delta,
            messageId: event.messageId,
            agentName: event.agentName,
        });
    }

    select(planId: string, planningAgentName: string): PlanReviewConversation {
        if (this.disposed) throw new Error("Plan review conversation is disposed");
        let conversation = this.conversations.get(planId);
        if (!conversation) {
            conversation = {
                id: crypto.randomUUID(),
                agentLabel: planningAgentLabel(planningAgentName),
                revision: 0,
                events: [],
            };
            this.conversations.set(planId, conversation);
        }
        this.activePlanId = planId;
        this.activeAgentName = planningAgentName;
        conversation.agentLabel = planningAgentLabel(planningAgentName);
        return conversation;
    }

    /** End capture after a final decision. A conversation turn is not final. */
    stopCapture(planId: string): void {
        if (this.activePlanId !== planId) return;
        this.activePlanId = null;
        this.activeAgentName = null;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.activePlanId = null;
        this.activeAgentName = null;
        const ids = [...this.conversations.values()].map((conversation) => conversation.id);
        this.conversations.clear();
        if (ids.length) {
            try {
                const { stopPlanReviewConversationSurface } = await import("../../ui/review/review-launcher.ts");
                await Promise.all(ids.map((id) => stopPlanReviewConversationSurface(id).catch(() => {})));
            } catch {
                // Session disposal must complete even if a review surface failed to start or stop.
            }
        }
    }
}
