/**
 * Shared RunWield badge primitive.
 */

/** @typedef {"default" | "success" | "warning" | "danger" | "muted"} BadgeVariant */

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/**
 * @param {BadgeVariant} variant
 * @returns {string | undefined}
 */
function badgeVariantClassName(variant = "default") {
    if (variant === "default") return undefined;
    return variant;
}

/** @param {{ variant?: BadgeVariant, class?: string, className?: string, children?: any, [key: string]: any }} props */
export function Badge({ variant = "default", class: className, className: compatClassName, children, ...props }) {
    return (
        <span {...props} class={classNames(["badge", badgeVariantClassName(variant), className, compatClassName])}>
            {children}
        </span>
    );
}
