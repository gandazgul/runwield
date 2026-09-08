import { useEffect, useState } from "react";
import {
    readBrowserNotificationStatus,
    requestBrowserNotificationPermission,
} from "../browser/session-tab-notifications.ts";

type Status = "default" | "enabled" | "blocked" | "unavailable";

function statusLabel(status: Status) {
    if (status === "enabled") return "Alerts enabled";
    if (status === "blocked") return "Alerts blocked";
    if (status === "unavailable") return "Alerts unavailable";
    return "Enable alerts";
}

function detectStatus(): Status {
    if (typeof window === "undefined") return "unavailable";
    const status = readBrowserNotificationStatus();
    if (status === "enabled" || status === "blocked" || status === "unavailable") {
        if (
            status === "unavailable" && "Notification" in globalThis && globalThis.isSecureContext &&
            Notification.permission === "default"
        ) {
            return "default";
        }
        return status;
    }
    return "default";
}

export function BrowserNotificationPermissionControl() {
    const [status, setStatus] = useState<Status>("unavailable");

    useEffect(() => {
        const update = () => setStatus(detectStatus());
        update();
        globalThis.addEventListener("runwield:browser-notification-status", update);
        globalThis.addEventListener("storage", update);
        globalThis.addEventListener("focus", update);
        document.addEventListener("visibilitychange", update);
        return () => {
            globalThis.removeEventListener("runwield:browser-notification-status", update);
            globalThis.removeEventListener("storage", update);
            globalThis.removeEventListener("focus", update);
            document.removeEventListener("visibilitychange", update);
        };
    }, []);

    const label = statusLabel(status);
    const title = status === "blocked" ? "Alerts blocked. Enable notifications in browser settings." : label;
    return (
        <button
            type="button"
            className={`rw-toolbar-button workspace-alerts-button workspace-alerts-button-${status}`}
            title={title}
            aria-label={label}
            aria-disabled={status !== "default" ? true : undefined}
            onClick={async () => {
                if (status !== "default") return;
                setStatus(await requestBrowserNotificationPermission());
            }}
        >
            <span aria-hidden="true">🔔</span>
            <span className="workspace-alerts-label">{label}</span>
        </button>
    );
}
