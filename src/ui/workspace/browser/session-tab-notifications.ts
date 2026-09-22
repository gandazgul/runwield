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
    notificationSurface?: string;
    url?: string;
};

type TrackedNotification = {
    close(): void;
    onclick: ((event: Event) => void) | null;
};

export type SessionTabNotificationController = {
    notifyAgentStopped(
        event: BrowserAttentionEvent,
        policy: BrowserNotificationPolicy | null | undefined,
    ): Promise<void>;
    dispose(): void;
};

const DEFAULT_SESSION_NAME = "RunWield";

export function createSessionTabNotificationController(): SessionTabNotificationController {
    const active = new Set<TrackedNotification>();
    let disposed = false;

    return {
        async notifyAgentStopped(event, policy) {
            if (disposed || !canNotifyAgentStopped(event, policy)) return;
            const NotificationConstructor = globalThis.Notification;
            if (typeof NotificationConstructor !== "function" || NotificationConstructor.permission !== "granted") {
                return;
            }
            if (
                policy?.suppressWhenFocused !== false && document.visibilityState === "visible" && document.hasFocus()
            ) return;

            try {
                const title = buildSharedNotificationTitle(
                    "agentStopped",
                    normalizedSessionName(event.sessionName),
                    event.agentName,
                );
                const body = getNotificationBaseMessage("agentStopped");
                const href = event.url ? new URL(event.url, globalThis.location?.href).href : globalThis.location?.href;
                if (globalThis.navigator?.serviceWorker) {
                    const registration = await navigator.serviceWorker.getRegistration();
                    if (disposed) return;
                    if (registration?.active) {
                        await registration.showNotification(title, {
                            body,
                            icon: "/pwa/icon-192.png",
                            data: { url: href },
                        });
                        return;
                    }
                }
                const notification = new NotificationConstructor(title, { body }) as TrackedNotification;
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
                        if (event.url && globalThis.location) globalThis.location.assign(event.url);
                    } catch {
                        // Browser-owned best effort.
                    }
                };
            } catch (error) {
                // Keep the turn running, but expose delivery failures for diagnosis.
                console.warn("Workspace notification delivery failed:", error);
            }
        },
        dispose() {
            disposed = true;
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
    return event.type === "attention_requested" && event.reason === "agentStopped" &&
        (!event.notificationSurface || event.notificationSurface === "workspace") && policy?.enabled !== false &&
        policy?.events?.agentStopped !== false;
}

function normalizedSessionName(value: string | undefined): string {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized || DEFAULT_SESSION_NAME;
}
