// @jsxImportSource preact
/**
 * Shared RunWield notice primitive.
 */

/** @typedef {"default" | "success" | "muted" | "warning" | "danger"} NoticeVariant */

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/**
 * @param {NoticeVariant} variant
 * @returns {string | undefined}
 */
function noticeVariantClassName(variant = "default") {
    if (variant === "default") return undefined;
    return variant;
}

/** @param {{ variant?: NoticeVariant, class?: string, className?: string, children?: any, [key: string]: any }} props */
export function Notice({ variant = "default", class: className, className: compatClassName, children, ...props }) {
    return (
        <div {...props} className={classNames(["notice", noticeVariantClassName(variant), className, compatClassName])}>
            {children}
        </div>
    );
}
