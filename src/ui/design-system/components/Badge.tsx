// @jsxImportSource preact
import type { HTMLAttributes } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: BadgeVariant;
    class?: string;
    className?: string;
}

type ClassNamePart = string | undefined | false | null;

function classNames(parts: ClassNamePart[]) {
    return parts.filter(Boolean).join(" ");
}

function badgeVariantClassName(variant: BadgeVariant = "default") {
    if (variant === "default") return undefined;
    return variant;
}

export function Badge(
    { variant = "default", class: className, className: compatClassName, children, ...props }: BadgeProps,
) {
    return (
        <span {...props} className={classNames(["badge", badgeVariantClassName(variant), className, compatClassName])}>
            {children}
        </span>
    );
}
