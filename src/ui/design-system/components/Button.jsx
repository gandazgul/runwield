// @jsxImportSource preact
/**
 * Shared RunWield action primitive.
 */

/** @typedef {"primary" | "secondary" | "danger"} ButtonVariant */

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/**
 * @param {ButtonVariant} variant
 * @returns {string}
 */
export function actionClassName(variant = "secondary") {
    if (variant === "primary") return "primary-action";
    if (variant === "danger") return "danger-action";
    return "secondary-action";
}

/**
 * @param {{ variant?: ButtonVariant, class?: string, className?: string, children?: any, [key: string]: any }} props
 */
export function Button(
    { variant = "secondary", class: className, className: compatClassName, children, ...buttonProps },
) {
    return (
        <button {...buttonProps} className={classNames([actionClassName(variant), className, compatClassName])}>
            {children}
        </button>
    );
}
