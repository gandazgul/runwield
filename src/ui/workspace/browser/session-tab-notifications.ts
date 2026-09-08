import {
    type BrowserNotificationPolicy,
    buildSharedNotificationTitle,
    getNotificationBaseMessage,
} from "../../../shared/session/notification-content.ts";

type BrowserAttentionEvent = {
    type?: string;
    reason?: string;
    agentName?: string;
    sessionName?: string;
};

type TrackedNotification = {
    close(): void;
    onclick: ((event: Event) => void) | null;
};

export type SessionTabNotificationController = {
    notifyAgentStopped(event: BrowserAttentionEvent, policy: BrowserNotificationPolicy | null | undefined): void;
    dispose(): void;
};

const DEFAULT_SESSION_NAME = "RunWield";

export function createSessionTabNotificationController(): SessionTabNotificationController {
    const active = new Set<TrackedNotification>();

    return {
        notifyAgentStopped(event, policy) {
            if (!canNotifyAgentStopped(event, policy)) return;
            const NotificationConstructor = globalThis.Notification;
            if (typeof NotificationConstructor !== "function" || NotificationConstructor.permission !== "granted") {
                return;
            }
            if (
                policy?.suppressWhenFocused !== false && document.visibilityState === "visible" && document.hasFocus()
            ) return;

            try {
                const notification = new NotificationConstructor(
                    buildSharedNotificationTitle(
                        "agentStopped",
                        normalizedSessionName(event.sessionName),
                        event.agentName,
                    ),
                    { body: getNotificationBaseMessage("agentStopped") },
                ) as TrackedNotification;
                active.add(notification);
                notification.onclick = () => {
                    try {
                        notification.close();
                    } catch {
                        // Browser-owned best effort.
                    }
                    active.delete(notification);
                    try {
                        globalThis.focus();
                    } catch {
                        // Browser-owned best effort.
                    }
                };
            } catch {
                // Notification delivery must not affect the Session turn.
            }
        },
        dispose() {
            for (const notification of active) {
                try {
                    notification.onclick = null;
                    notification.close();
                } catch {
                    // Browser-owned best effort.
                }
            }
            active.clear();
        },
    };
}

export function canNotifyAgentStopped(
    event: BrowserAttentionEvent,
    policy: BrowserNotificationPolicy | null | undefined,
): boolean {
    return event.type === "attention_requested" && event.reason === "agentStopped" && policy?.enabled !== false &&
        policy?.events?.agentStopped !== false;
}

function normalizedSessionName(value: string | undefined): string {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized || DEFAULT_SESSION_NAME;
}
