import { useEffect, useState } from "react";

function readPermission(): NotificationPermission | "unsupported" {
    if (typeof globalThis.Notification !== "function") return "unsupported";
    return globalThis.Notification.permission;
}

export function BrowserNotificationPermissionControl() {
    const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

    useEffect(() => {
        setPermission(readPermission());
    }, []);

    const requestPermission = async () => {
        if (typeof globalThis.Notification !== "function" || Notification.permission !== "default") return;
        try {
            setPermission(await Notification.requestPermission());
        } catch {
            setPermission(readPermission());
        }
    };

    if (permission === "unsupported") {
        return (
            <span
                className="rw-toolbar-button workspace-notification-control"
                aria-label="Alerts unavailable"
                title="Alerts unavailable"
            >
                <span aria-hidden="true">🔕</span>
                <span>Alerts unavailable</span>
            </span>
        );
    }

    if (permission === "granted") {
        return (
            <span
                className="rw-toolbar-button workspace-notification-control"
                aria-label="Alerts enabled"
                title="Alerts enabled"
            >
                <span aria-hidden="true">🔔</span>
                <span>Alerts enabled</span>
            </span>
        );
    }

    if (permission === "denied") {
        return (
            <span
                className="rw-toolbar-button workspace-notification-control"
                aria-label="Alerts blocked. Change browser site settings to enable alerts."
                title="Alerts blocked. Change browser site settings to enable alerts."
            >
                <span aria-hidden="true">🔕</span>
                <span>Alerts blocked</span>
            </span>
        );
    }

    return (
        <button
            type="button"
            className="rw-toolbar-button workspace-notification-control"
            onClick={requestPermission}
            aria-label="Enable alerts"
            title="Enable alerts"
        >
            <span aria-hidden="true">🔔</span>
            <span>Enable alerts</span>
        </button>
    );
}
