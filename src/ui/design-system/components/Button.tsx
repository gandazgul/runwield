// @jsxImportSource preact
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    class?: string;
}

type ClassNamePart = string | undefined | false | null;

function classNames(parts: ClassNamePart[]) {
    return parts.filter(Boolean).join(" ");
}

export function actionClassName(variant: ButtonVariant = "secondary") {
    if (variant === "primary") return "primary-action";
    if (variant === "danger") return "danger-action";
    return "secondary-action";
}

export function Button(
    { variant = "secondary", class: className, className: compatClassName, children, ...buttonProps }: ButtonProps,
) {
    return (
        <button {...buttonProps} className={classNames([actionClassName(variant), className, compatClassName])}>
            {children}
        </button>
    );
}
