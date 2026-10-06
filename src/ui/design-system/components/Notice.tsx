// @jsxImportSource preact
import type { HTMLAttributes } from "react";

export type NoticeVariant = "default" | "success" | "warning" | "danger" | "muted";

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
    variant?: NoticeVariant;
    class?: string;
    className?: string;
}

type ClassNamePart = string | undefined | false | null;

function classNames(parts: ClassNamePart[]) {
    return parts.filter(Boolean).join(" ");
}

function noticeVariantClassName(variant: NoticeVariant = "default") {
    if (variant === "default") return undefined;
    return variant;
}

export function Notice(
    { variant = "default", class: className, className: compatClassName, children, ...props }: NoticeProps,
) {
    return (
        <div {...props} className={classNames(["notice", noticeVariantClassName(variant), className, compatClassName])}>
            {children}
        </div>
    );
}
