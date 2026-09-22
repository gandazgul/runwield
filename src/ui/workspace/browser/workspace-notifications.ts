import { type BrowserNotificationPolicy } from "../../../shared/session/notification-content.ts";
import { createSessionTabNotificationController } from "./session-tab-notifications.ts";

type WorkspaceNotification = {
    event: {
        type: string;
        reason: string;
        notificationSurface: string;
        agentName?: string;
        sessionName?: string;
    };
    url: string;
    policy: BrowserNotificationPolicy;
};

let started = false;

/** Astro page transitions keep this connection and its notification controller alive. */
export function startWorkspaceNotifications() {
    if (started) return;
    started = true;
    const controller = createSessionTabNotificationController();
    let stream: EventSource | null = null;
    const connect = () => {
        if (stream) return;
        stream = new EventSource("/api/owner/notifications/stream");
        stream.onmessage = (message) => {
            try {
                const notification: WorkspaceNotification = JSON.parse(message.data);
                void controller.notifyAgentStopped(
                    { ...notification.event, url: notification.url },
                    notification.policy,
                );
            } catch (error) {
                console.warn("Workspace notification could not be read:", error);
            }
        };
    };
    addEventListener("pagehide", () => {
        stream?.close();
        stream = null;
    });
    addEventListener("pageshow", connect);
    connect();
}
