// @jsxImportSource preact
/**
 * Shared RunWield card primitives.
 */

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/** @param {{ compact?: boolean, clickable?: boolean, class?: string, className?: string, children?: any, [key: string]: any }} props */
export function Card(
    { compact = false, clickable = false, class: className, className: compatClassName, children, ...props },
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

/** @param {{ class?: string, className?: string, children?: any, [key: string]: any }} props */
export function CardHeader({ class: className, className: compatClassName, children, ...props }) {
    return <div {...props} className={classNames(["card-header", className, compatClassName])}>{children}</div>;
}

/** @param {{ class?: string, className?: string, children?: any, [key: string]: any }} props */
export function CardKicker({ class: className, className: compatClassName, children, ...props }) {
    return <p {...props} className={classNames(["card-kicker", className, compatClassName])}>{children}</p>;
}

/** @param {{ class?: string, className?: string, children?: any, [key: string]: any }} props */
export function CardTitle({ class: className, className: compatClassName, children, ...props }) {
    return <span {...props} className={classNames(["card-title", className, compatClassName])}>{children}</span>;
}
