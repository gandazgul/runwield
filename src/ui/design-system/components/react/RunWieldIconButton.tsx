import type { ButtonHTMLAttributes } from "react";

type RunWieldIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Borderless toolbar control shared by menus and panel toggles. */
export function RunWieldIconButton({ className = "", ...props }: RunWieldIconButtonProps) {
    return <button type="button" {...props} className={`rw-icon-button ${className}`.trim()} />;
}
