// @jsxImportSource preact
/**
 * Shared RunWield Dialog primitive.
 */

import * as dialog from "@zag-js/dialog";
import { normalizeProps, Portal, useMachine } from "@zag-js/preact";
import { useId } from "preact/hooks";

const DialogPortal = /** @type {any} */ (Portal);

/** @typedef {"primary" | "secondary" | "danger"} DialogActionVariant */

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/**
 * @param {DialogActionVariant} variant
 * @returns {string}
 */
function actionClassName(variant = "secondary") {
    if (variant === "primary") return "primary-action";
    if (variant === "danger") return "danger-action";
    return "secondary-action";
}

/**
 * @param {any} action
 * @param {number} index
 */
function DialogAction(action, index) {
    if (!action) return null;
    if (action.type || typeof action !== "object") return action;
    const { label, variant = "secondary", class: className, className: compatClassName, ...props } = action;
    return (
        <button
            key={action.key || index}
            {...props}
            className={classNames([actionClassName(variant), className, compatClassName])}
        >
            {label}
        </button>
    );
}

/**
 * @param {{
 *   id?: string,
 *   trigger?: any | ((api: any) => any),
 *   title?: any,
 *   description?: any,
 *   footer?: any | any[],
 *   open?: boolean,
 *   defaultOpen?: boolean,
 *   onOpenChange?: (open: boolean) => void,
 *   modal?: boolean,
 *   closeOnEscape?: boolean,
 *   closeOnInteractOutside?: boolean,
 *   class?: string,
 *   className?: string,
 *   children?: any,
 * }} props
 */
export function Dialog({
    id,
    trigger,
    title,
    description,
    footer,
    open,
    defaultOpen = false,
    onOpenChange,
    modal = true,
    closeOnEscape = true,
    closeOnInteractOutside = true,
    class: className,
    className: compatClassName,
    children,
}) {
    const generatedId = useId();
    const service = useMachine(dialog.machine, {
        id: id || generatedId,
        open,
        defaultOpen,
        modal,
        closeOnEscape,
        closeOnInteractOutside,
        /** @param {{ open: boolean }} details */
        onOpenChange: (details) => onOpenChange?.(details.open),
    });
    const api = dialog.connect(service, normalizeProps);
    const actions = Array.isArray(footer) ? footer : footer ? [footer] : [];
    const triggerProps = /** @type {any} */ (api.getTriggerProps());
    const backdropProps = /** @type {any} */ (api.getBackdropProps());
    const positionerProps = /** @type {any} */ (api.getPositionerProps());
    const contentProps = /** @type {any} */ (api.getContentProps());
    const titleProps = /** @type {any} */ (api.getTitleProps());
    const descriptionProps = /** @type {any} */ (api.getDescriptionProps());

    return (
        <>
            {typeof trigger === "function"
                ? trigger(api)
                : trigger
                ? <button {...triggerProps} className="secondary-action">{trigger}</button>
                : null}
            {api.open
                ? (
                    <DialogPortal>
                        <div {...backdropProps} className="rw-dialog-backdrop" />
                        <div {...positionerProps} className="rw-dialog-positioner">
                            <section
                                {...contentProps}
                                className={classNames(["rw-dialog-panel", className, compatClassName])}
                            >
                                <header className="rw-dialog-header">
                                    {title ? <h2 {...titleProps} className="rw-dialog-title">{title}</h2> : null}
                                    {description
                                        ? (
                                            <p {...descriptionProps} className="rw-dialog-description">
                                                {description}
                                            </p>
                                        )
                                        : null}
                                </header>
                                <div className="rw-dialog-body">{children}</div>
                                {actions.length
                                    ? <footer className="rw-dialog-footer">{actions.map(DialogAction)}</footer>
                                    : null}
                            </section>
                        </div>
                    </DialogPortal>
                )
                : null}
        </>
    );
}
