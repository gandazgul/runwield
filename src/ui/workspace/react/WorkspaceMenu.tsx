import { RunWieldMenu } from "../../design-system/components/react/RunWieldMenu.tsx";
import { BrowserNotificationPermissionControl } from "./BrowserNotificationPermissionControl.tsx";

export function WorkspaceMenu() {
    return (
        <RunWieldMenu label="Workspace menu">
            <BrowserNotificationPermissionControl />
            <a
                className="rw-menu-item"
                href="https://docs.runwield.dev"
                target="_blank"
                rel="noreferrer"
            >
                <span className="rw-menu-item-icon" aria-hidden="true">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 0v16M11 8h5M11 12h5"
                        />
                    </svg>
                </span>
                <span>Documentation</span>
            </a>
        </RunWieldMenu>
    );
}
