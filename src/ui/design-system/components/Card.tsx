// @jsxImportSource preact
import type { HTMLAttributes } from "react";

export interface CardElementProps<Element extends HTMLElement> extends HTMLAttributes<Element> {
    class?: string;
}

export interface CardProps extends CardElementProps<HTMLElement> {
    compact?: boolean;
    clickable?: boolean;
}

export type CardHeaderProps = CardElementProps<HTMLDivElement>;
export type CardKickerProps = CardElementProps<HTMLParagraphElement>;
export type CardTitleProps = CardElementProps<HTMLSpanElement>;

type ClassNamePart = string | undefined | false | null;

function classNames(parts: ClassNamePart[]) {
    return parts.filter(Boolean).join(" ");
}

export function Card(
    { compact = false, clickable = false, class: className, className: compatClassName, children, ...props }: CardProps,
) {
    return (
        <article
            {...props}
            className={classNames([
                "plan-card",
                compact && "compact",
                clickable && "clickable-card",
                className,
                compatClassName,
            ])}
        >
            {children}
        </article>
    );
}

export function CardHeader({ class: className, className: compatClassName, children, ...props }: CardHeaderProps) {
    return <div {...props} className={classNames(["card-header", className, compatClassName])}>{children}</div>;
}

export function CardKicker({ class: className, className: compatClassName, children, ...props }: CardKickerProps) {
    return <p {...props} className={classNames(["card-kicker", className, compatClassName])}>{children}</p>;
}

export function CardTitle({ class: className, className: compatClassName, children, ...props }: CardTitleProps) {
    return <span {...props} className={classNames(["card-title", className, compatClassName])}>{children}</span>;
}
