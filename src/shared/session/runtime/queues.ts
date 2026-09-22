import { steerActiveSessionWithTarget, steerAgentSessionWithTarget } from ".././session.js";
import { getRuntimeErrorMessage, RuntimeEventTypes } from ".././session-runtime-events.js";

import { getRuntimeRootAgentSession, isRuntimeAgentSession, toRuntimeQueuedMessage } from "./support.ts";
import type { RuntimeAgentSession } from "./support.ts";
import type { QueueSourceSubscription, RuntimeQueuedMessageState } from "./types.ts";

import type { RuntimeServices } from "./base.ts";
import type { RuntimeEvents } from "./events.ts";
import type { RuntimeImages } from "./images.ts";
import type { RuntimeManagedOperations } from "./managed-operations.ts";
import type { RuntimeManagedSync } from "./managed-sync.ts";
import type { RuntimeTurns } from "./turns.ts";

type RuntimeEventsDependency = Pick<RuntimeEvents, "emitSessionEvent">;
type RuntimeImagesDependency = Pick<RuntimeImages, "preflightImagesForAgentSession">;
type RuntimeManagedOperationsDependency = Pick<
    RuntimeManagedOperations,
    "currentCapability" | "hasOperation" | "rejectManagedPublicMutation" | "runManagedStandaloneMutation"
>;
type RuntimeManagedSyncDependency = Pick<RuntimeManagedSync, "synchronizeManagedSession">;
type RuntimeTurnsDependency = Pick<RuntimeTurns, "promptUserTurn">;

export class RuntimeQueues {
    private events!: RuntimeEventsDependency;
    private images!: RuntimeImagesDependency;
    private managedOperations!: RuntimeManagedOperationsDependency;
    private sync!: RuntimeManagedSyncDependency;
    private turns!: RuntimeTurnsDependency;

    constructor(private readonly services: RuntimeServices) {}

    connect(
        events: RuntimeEventsDependency,
        images: RuntimeImagesDependency,
        managedOperations: RuntimeManagedOperationsDependency,
        sync: RuntimeManagedSyncDependency,
        turns: RuntimeTurnsDependency,
    ) {
        this.events = events;
        this.images = images;
        this.managedOperations = managedOperations;
        this.sync = sync;
        this.turns = turns;
    }
    private queuedMessages = new Map<string, RuntimeQueuedMessageState[]>();
    private queueSourceSubscriptions = new Map<string, Map<RuntimeAgentSession, QueueSourceSubscription>>();
    private queuedMessageDrainTasks = new Map<string, Promise<void>>();

    cleanupSession(sessionId: string) {
        this.removeAllQueueSourceSubscriptions(sessionId);
        this.queuedMessages.delete(sessionId);
        this.queuedMessageDrainTasks.delete(sessionId);
    }

    getQueuedMessages(sessionId: string) {
        return (this.queuedMessages.get(sessionId) || []).map(toRuntimeQueuedMessage);
    }

    scheduleQueuedMessageDrain(sessionId: string) {
        if (this.queuedMessageDrainTasks.has(sessionId)) return;
        const task = this.drainQueuedMessages(sessionId).finally(() => {
            if (this.queuedMessageDrainTasks.get(sessionId) === task) {
                this.queuedMessageDrainTasks.delete(sessionId);
            }
        });
        this.queuedMessageDrainTasks.set(sessionId, task);
    }

    async drainQueuedMessages(sessionId: string) {
        while (this.services.sessionHost.getSession(sessionId)) {
            const hostedSession = this.services.sessionHost.getSession(sessionId);
            const managed = hostedSession?.getManagedMetadata?.() || null;
            if (!hostedSession || !managed || !this.services.sessionStore) return;
            const queued = (this.queuedMessages.get(sessionId) || [])
                .filter((message) => message.delivery === "next_turn");
            if (queued.length === 0) return;
            const state = this.services.sessionStore.inspectSessionActivation(managed.runwieldSessionId);
            if (state.activation?.state !== "idle" || this.managedOperations.hasOperation(sessionId)) {
                await new Promise((resolve) => setTimeout(resolve, 300));
                continue;
            }
            await this.sync.synchronizeManagedSession(sessionId, { emitEvents: false });
            const claimed = this.takeNextTurnMessage(sessionId).message;
            if (!claimed) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                continue;
            }
            try {
                await this.turns.promptUserTurn(sessionId, {
                    inputSurface: hostedSession.notificationSurface || claimed.inputSurface,
                    initialRequest: claimed.text,
                    initialImages: claimed.images,
                });
            } catch {
                this.queueNextTurnMessage(sessionId, claimed.text, claimed.images, {
                    deliverWhenAvailable: true,
                    inputSurface: claimed.inputSurface,
                });
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
        }
    }

    ensureQueueSourceSubscription(
        hostedSession: import(".././hosted-session.js").HostedSession,
        sourceSession: RuntimeAgentSession,
    ) {
        let subscriptions = this.queueSourceSubscriptions.get(hostedSession.id);
        if (!subscriptions) {
            subscriptions = new Map();
            this.queueSourceSubscriptions.set(hostedSession.id, subscriptions);
        }
        if (subscriptions.has(sourceSession)) return;
        const unsubscribe = sourceSession.subscribe((event) => {
            if (event.type !== "queue_update") return;
            this.reconcileQueuedMessages(hostedSession, sourceSession, event.steering);
        });
        subscriptions.set(sourceSession, { sourceSession, unsubscribe });
    }

    reconcileQueuedMessages(
        hostedSession: import(".././hosted-session.js").HostedSession,
        sourceSession: RuntimeAgentSession,
        steering: readonly string[] | undefined,
    ) {
        const sourceMessages = (this.queuedMessages.get(hostedSession.id) || [])
            .filter((message) => message.sourceSession === sourceSession);
        const consumedCount = Math.max(0, sourceMessages.length - (steering?.length || 0));
        for (const message of sourceMessages.slice(0, consumedCount)) {
            this.transitionQueuedMessage(hostedSession, message, "consumed");
        }
        const sourceStillQueued = (this.queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (!sourceStillQueued) this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
    }

    reconcileQueuedMessageSources(hostedSession: import(".././hosted-session.js").HostedSession) {
        const subscriptions = this.queueSourceSubscriptions.get(hostedSession.id);
        if (!subscriptions) return;
        for (const { sourceSession } of [...subscriptions.values()]) {
            const activeSteering = sourceSession.getSteeringMessages?.();
            if (Array.isArray(activeSteering)) {
                this.reconcileQueuedMessages(hostedSession, sourceSession, activeSteering);
            }
        }
    }

    removeQueueSourceSubscription(
        sessionId: string,
        sourceSession: RuntimeAgentSession,
    ) {
        const subscriptions = this.queueSourceSubscriptions.get(sessionId);
        if (!subscriptions) return;
        const subscription = subscriptions.get(sourceSession);
        if (!subscription) return;
        subscription.unsubscribe();
        subscriptions.delete(sourceSession);
        if (subscriptions.size === 0) this.queueSourceSubscriptions.delete(sessionId);
    }

    removeAllQueueSourceSubscriptions(sessionId: string) {
        const subscriptions = this.queueSourceSubscriptions.get(sessionId);
        if (!subscriptions) return;
        for (const subscription of subscriptions.values()) subscription.unsubscribe();
        this.queueSourceSubscriptions.delete(sessionId);
    }

    transitionQueuedMessage(
        hostedSession: import(".././hosted-session.js").HostedSession,
        message: RuntimeQueuedMessageState,
        status: "consumed" | "dequeued",
        reason: string = "",
    ) {
        const queue = this.queuedMessages.get(hostedSession.id);
        const index = queue?.indexOf(message) ?? -1;
        if (!queue || index < 0) return null;
        queue.splice(index, 1);
        if (queue.length === 0) this.queuedMessages.delete(hostedSession.id);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.events.emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status,
            message: publicMessage,
            ...(reason ? { reason } : {}),
        });
        if (status === "consumed" && message.delivery === "steer") {
            this.events.emitSessionEvent(hostedSession.id, {
                type: RuntimeEventTypes.USER_MESSAGE,
                messageId: message.id,
                text: message.text,
                images: message.images.map((image) => ({ ...image })),
            });
        }
        return publicMessage;
    }

    async steerSession(
        sessionId: string,
        text: string,
        images: import(".././types.js").ImageAttachment[] = [],
        inputSurface: import("../session-runtime-events.js").NotificationSurface = this.services.ownerProcessKind,
    ): Promise<import("./types.ts").SteerSessionResult> {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const capability = this.managedOperations.currentCapability(sessionId) ||
            hostedSession.getManagedOperationCapability?.() || null;
        const managedRejection = this.managedOperations.rejectManagedPublicMutation(
            hostedSession,
            "steerSession",
            capability,
        );
        if (managedRejection) return { ...managedRejection, queued: false };
        if (hostedSession.isAgentTransitioning?.()) {
            const candidate = hostedSession.getActiveSteeringTargetSession?.();
            const activeTarget = isRuntimeAgentSession(candidate) ? candidate : null;
            const imagePreflight = await this.images.preflightImagesForAgentSession(
                hostedSession,
                images,
                activeTarget || getRuntimeRootAgentSession(hostedSession),
            );
            if (!imagePreflight.ok) throw new Error(imagePreflight.message);
            if (hostedSession.queueAgentTransitionSteering(text, images)) {
                hostedSession.notificationSurface = inputSurface;
                return { ok: true, queued: true };
            }
        }
        const candidate = hostedSession.getActiveSteeringTargetSession?.();
        const activeTarget = isRuntimeAgentSession(candidate) ? candidate : null;
        const rootSession = getRuntimeRootAgentSession(hostedSession);
        const expectedTarget = activeTarget?.isStreaming ? activeTarget : rootSession;
        if (!expectedTarget?.isStreaming) return { ok: true, queued: false, reason: "not_streaming" };
        const imagePreflight = await this.images.preflightImagesForAgentSession(hostedSession, images, expectedTarget);
        if (!imagePreflight.ok) throw new Error(imagePreflight.message);

        this.ensureQueueSourceSubscription(hostedSession, expectedTarget);
        const sourceSession = await steerActiveSessionWithTarget(hostedSession, text, images);
        if (!sourceSession) {
            this.removeQueueSourceSubscription(hostedSession.id, expectedTarget);
            return { ok: true, queued: false, reason: "not_streaming" };
        }

        const message: RuntimeQueuedMessageState = {
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            inputSurface,
            delivery: "steer",
            queuedAt: new Date().toISOString(),
            sourceSession,
        };
        this.ensureQueueSourceSubscription(hostedSession, sourceSession);
        hostedSession.notificationSurface = inputSurface;
        const publicMessage = this.trackQueuedMessage(hostedSession, message);
        const activeSteering = sourceSession.getSteeringMessages?.();
        if (Array.isArray(activeSteering)) {
            this.reconcileQueuedMessages(hostedSession, sourceSession, activeSteering);
        }
        return { ok: true, queued: true, message: publicMessage };
    }

    queueNextTurnMessage(
        sessionId: string,
        text: string,
        images: import(".././types.js").ImageAttachment[] = [],
        options: {
            deliverWhenAvailable?: boolean;
            inputSurface?: import("../session-runtime-events.js").NotificationSurface;
        } = {},
    ): import("./types.ts").SteerSessionResult {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, queued: false, error: "not_found" };
        const message: RuntimeQueuedMessageState = {
            id: crypto.randomUUID(),
            text,
            images: images.map((image) => ({ ...image })),
            inputSurface: options.inputSurface || this.services.ownerProcessKind,
            delivery: "next_turn",
            queuedAt: new Date().toISOString(),
        };
        const publicMessage = this.trackQueuedMessage(hostedSession, message);
        hostedSession.notificationSurface = message.inputSurface || this.services.ownerProcessKind;
        if (options.deliverWhenAvailable) this.scheduleQueuedMessageDrain(sessionId);
        return { ok: true, queued: true, message: publicMessage };
    }

    takeNextTurnMessage(sessionId: string) {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const selected = (this.queuedMessages.get(hostedSession.id) || [])
            .find((message) => message.delivery === "next_turn");
        if (!selected) return { ok: true, message: null };
        const publicMessage = this.transitionQueuedMessage(hostedSession, selected, "consumed");
        return { ok: true, message: publicMessage };
    }

    trackQueuedMessage(
        hostedSession: import(".././hosted-session.js").HostedSession,
        message: RuntimeQueuedMessageState,
    ) {
        let queue = this.queuedMessages.get(hostedSession.id);
        if (!queue) {
            queue = [];
            this.queuedMessages.set(hostedSession.id, queue);
        }
        queue.push(message);
        const publicMessage = toRuntimeQueuedMessage(message);
        this.events.emitSessionEvent(hostedSession.id, {
            type: RuntimeEventTypes.QUEUED_MESSAGE_CHANGED,
            status: "queued",
            message: publicMessage,
        });
        return publicMessage;
    }

    async dequeueLastQueuedMessage(sessionId: string) {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, message: null, error: "not_found" };
        const queue = this.queuedMessages.get(hostedSession.id) || [];
        const selected = queue.at(-1) || null;
        if (!selected) return { ok: true, message: null };

        if (selected.delivery === "next_turn") {
            const publicMessage = this.transitionQueuedMessage(
                hostedSession,
                selected,
                "dequeued",
                "user_recall",
            );
            return { ok: true, message: publicMessage };
        }

        const capability = this.managedOperations.currentCapability(sessionId) || null;
        const managedRejection = this.managedOperations.rejectManagedPublicMutation(
            hostedSession,
            "dequeueLastQueuedMessage",
            capability,
        );
        if (managedRejection) return { ...managedRejection, message: null };

        const sourceSession = selected.sourceSession;
        if (!sourceSession) return { ok: false, message: null, error: "queue_not_mutable" };
        if (typeof sourceSession.clearQueue !== "function") {
            return { ok: false, message: null, error: "queue_not_mutable" };
        }
        const sourceMessages = queue.filter((message) => message.sourceSession === sourceSession);
        this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
        let cleared;
        try {
            cleared = sourceSession.clearQueue();
        } catch (error) {
            this.ensureQueueSourceSubscription(hostedSession, sourceSession);
            return {
                ok: false,
                message: null,
                error: getRuntimeErrorMessage(error),
            };
        }

        let requeueError = "";
        try {
            for (const message of sourceMessages) {
                if (message.id === selected.id) continue;
                const requeued = await steerAgentSessionWithTarget(sourceSession, message.text, message.images);
                if (requeued !== sourceSession) {
                    throw new Error("source session stopped streaming while restoring its queue");
                }
            }
            const followUps = cleared && typeof cleared === "object" ? cleared.followUp || [] : [];
            for (const followUp of followUps) await sourceSession.followUp?.(followUp);
        } catch (error) {
            requeueError = getRuntimeErrorMessage(error);
        }

        const publicMessage = toRuntimeQueuedMessage(selected);
        if (requeueError) {
            for (const message of sourceMessages) {
                this.transitionQueuedMessage(
                    hostedSession,
                    message,
                    "dequeued",
                    message.id === selected.id ? "user_recall" : "requeue_failed",
                );
            }
            return { ok: true, message: publicMessage, warning: requeueError };
        }

        this.transitionQueuedMessage(hostedSession, selected, "dequeued", "user_recall");
        const sourceStillQueued = (this.queuedMessages.get(hostedSession.id) || [])
            .some((message) => message.sourceSession === sourceSession);
        if (sourceStillQueued) this.ensureQueueSourceSubscription(hostedSession, sourceSession);
        return { ok: true, message: publicMessage };
    }

    async clearQueuedMessages(sessionId: string, reason: string = "cleared") {
        const hostedSession = this.services.sessionHost.getSession(sessionId);
        if (!hostedSession) return { ok: false, cleared: 0, error: "not_found" };
        const managed = hostedSession.getManagedMetadata?.();
        if (managed && !hostedSession.getRootSessionManager?.()) {
            return await this.managedOperations.runManagedStandaloneMutation(
                sessionId,
                "submit_user_turn",
                (activeSession) => this.clearQueuedMessagesInternal(activeSession, reason),
                { activateAgent: false },
            );
        }
        const managedRejection = this.managedOperations.rejectManagedPublicMutation(
            hostedSession,
            "clearQueuedMessages",
        );
        if (managedRejection) return { ...managedRejection, cleared: 0 };
        return this.clearQueuedMessagesInternal(hostedSession, reason);
    }

    clearQueuedMessagesInternal(hostedSession: import(".././hosted-session.js").HostedSession, reason: string) {
        const messages = [...(this.queuedMessages.get(hostedSession.id) || [])];
        const sources = new Set(messages.map((message) => message.sourceSession).filter(Boolean));
        const clearedSources = new Set();
        for (const sourceSession of sources) {
            if (!sourceSession || typeof sourceSession.clearQueue !== "function") continue;
            this.removeQueueSourceSubscription(hostedSession.id, sourceSession);
            try {
                sourceSession.clearQueue();
                clearedSources.add(sourceSession);
            } catch {
                this.ensureQueueSourceSubscription(hostedSession, sourceSession);
            }
        }
        const clearedMessages = messages.filter((message) =>
            message.delivery === "next_turn" ||
            (message.sourceSession && clearedSources.has(message.sourceSession))
        );
        for (const message of clearedMessages) {
            this.transitionQueuedMessage(hostedSession, message, "dequeued", reason);
        }
        return { ok: true, cleared: clearedMessages.length };
    }
}
