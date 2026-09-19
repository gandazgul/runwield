import { RunWieldMenu } from "../../design-system/components/react/RunWieldMenu.tsx";
import { BrowserNotificationPermissionControl } from "./BrowserNotificationPermissionControl.tsx";

export function WorkspaceMenu() {
    return (
        <RunWieldMenu label="Workspace menu">
            <BrowserNotificationPermissionControl />
        </RunWieldMenu>
    );
}
