import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type WorkspaceHeaderActionsPortalProps = {
    children: ReactNode;
    enabled?: boolean;
};

export function WorkspaceHeaderActionsPortal({ children, enabled = true }: WorkspaceHeaderActionsPortalProps) {
    const [target, setTarget] = useState<HTMLElement | null>(null);

    useEffect(() => {
        setTarget(enabled ? document.querySelector<HTMLElement>("[data-workspace-header-actions]") : null);
    }, [enabled]);

    return enabled && target ? createPortal(children, target) : null;
}
