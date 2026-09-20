import { Popover } from "@base-ui/react";
import { type ReactNode, useState } from "react";
import { RunWieldIconButton } from "./RunWieldIconButton.tsx";

type RunWieldMenuContext = { closeMenu: () => void };

type RunWieldMenuProps = {
    label: string;
    children: ReactNode | ((context: RunWieldMenuContext) => ReactNode);
    iconOnly?: boolean;
    align?: "start" | "end";
};

export function RunWieldMenu({ label, children, iconOnly = true, align = "start" }: RunWieldMenuProps) {
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger
                render={<RunWieldIconButton />}
                className="rw-menu-trigger rw-panel-toggle"
                aria-label={label}
                title={label}
            >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor">
                    <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {!iconOnly && <span className="rw-menu-trigger-label">{label}</span>}
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Positioner side="bottom" align={align} sideOffset={4} className="rw-menu-positioner">
                    <Popover.Popup className="rw-menu-popup" aria-label={label} data-pn-dismissable-popover="true">
                        {typeof children === "function" ? children({ closeMenu: () => setOpen(false) }) : children}
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

type RunWieldMenuItemProps = {
    label: string;
    icon: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
};

export function RunWieldMenuItem({ label, icon, onClick, disabled = false, title }: RunWieldMenuItemProps) {
    return (
        <button type="button" className="rw-menu-item" onClick={onClick} disabled={disabled} title={title}>
            <span className="rw-menu-item-icon" aria-hidden="true">{icon}</span>
            <span>{label}</span>
        </button>
    );
}
