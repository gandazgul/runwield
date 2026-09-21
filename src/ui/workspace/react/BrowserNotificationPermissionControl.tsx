import { useEffect, useState } from "react";
import { RunWieldMenuItem } from "../../design-system/components/react/RunWieldMenu.tsx";

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

    const label = permission === "unsupported"
        ? "Alerts unavailable"
        : permission === "granted"
        ? "Alerts enabled"
        : permission === "denied"
        ? "Alerts blocked"
        : "Enable alerts";
    return (
        <RunWieldMenuItem
            label={label}
            disabled={permission !== "default"}
            onClick={requestPermission}
            title={permission === "denied" ? "Change browser site settings to enable alerts." : label}
            icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
                    />
                </svg>
            }
        />
    );
}
