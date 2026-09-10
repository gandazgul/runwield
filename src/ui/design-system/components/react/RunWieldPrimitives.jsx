import React from "react";
import * as Tabs from "@radix-ui/react-tabs";

/**
 * @param {Array<string | undefined | false | null>} parts
 * @returns {string}
 */
function classNames(parts) {
    return parts.filter(Boolean).join(" ");
}

/**
 * @param {{ variant?: "primary" | "secondary" | "danger", className?: string, children?: any, [key: string]: any }} props
 */
export function RunWieldButton({ variant = "secondary", className, children, ...props }) {
    const variantClass = variant === "primary"
        ? "primary-action"
        : variant === "danger"
        ? "danger-action"
        : "secondary-action";
    return React.createElement(
        "button",
        { type: "button", ...props, className: classNames([variantClass, className]) },
        children,
    );
}

/**
 * @typedef {Object} RunWieldPanelToggleProps
 * @property {"left" | "right"} side
 * @property {boolean} collapsed
 * @property {string} label
 * @property {string} controls
 * @property {() => void} onClick
 * @param {RunWieldPanelToggleProps} props
 */
export function RunWieldPanelToggle({ side, collapsed, label, controls, onClick }) {
    const pointsLeft = (side === "left") !== collapsed;
    const title = `${collapsed ? "Show" : "Collapse"} ${label}`;
    return (
        <button
            type="button"
            className="rw-toolbar-button rw-panel-toggle"
            aria-label={title}
            title={title}
            aria-expanded={!collapsed}
            aria-controls={controls}
            onClick={onClick}
        >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
                <path d="M5 4v16M19 4v16" strokeWidth="1.5" strokeLinecap="round" />
                <path
                    d={pointsLeft ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    );
}

/**
 * Use this for links that should look like RunWield actions. Navigation remains
 * an anchor, so browser affordances and accessibility semantics stay intact.
 *
 * @param {{ variant?: "primary" | "secondary" | "danger", className?: string, children?: any, [key: string]: any }} props
 */
export function RunWieldLink({ variant = "secondary", className, children, ...props }) {
    const variantClass = variant === "primary"
        ? "primary-action"
        : variant === "danger"
        ? "danger-action"
        : "secondary-action";
    return React.createElement("a", { ...props, className: classNames([variantClass, className]) }, children);
}

/**
 * @param {{ className?: string, children?: any, [key: string]: any }} props
 */
export function RunWieldCard({ className, children, ...props }) {
    return React.createElement("article", { ...props, className: classNames(["plan-card", className]) }, children);
}

/**
 * @param {{ label?: string, className?: string }} props
 */
export function RunWieldThinkingDots({ label = "Thinking", className }) {
    return React.createElement(
        "span",
        { className: classNames(["rw-thinking-dots", className]), role: "status", "aria-label": label },
        React.createElement("span", { "aria-hidden": "true" }, label),
        React.createElement("span", { className: "rw-thinking-dot", "aria-hidden": "true" }),
        React.createElement("span", { className: "rw-thinking-dot", "aria-hidden": "true" }),
        React.createElement("span", { className: "rw-thinking-dot", "aria-hidden": "true" }),
    );
}

/**
 * @typedef {Object} RunWieldTab
 * @property {string} value
 * @property {string} label
 * @property {import('react').ReactNode} children
 * @typedef {Object} RunWieldTabsProps
 * @property {string} defaultValue
 * @property {RunWieldTab[]} tabs
 * @property {string} [value]
 * @property {(value: string) => void} [onValueChange]
 * @property {boolean} [keepMounted]
 * @property {string} [label]
 * @param {RunWieldTabsProps} props
 */
export function RunWieldTabs(
    { defaultValue, tabs, value, onValueChange, keepMounted = false, label = "Review sections" },
) {
    return React.createElement(
        Tabs.Root,
        { defaultValue, value, onValueChange, className: "rw-react-tabs" },
        React.createElement(
            Tabs.List,
            { className: "tabs", "aria-label": label },
            tabs.map((tab) =>
                React.createElement(
                    Tabs.Trigger,
                    { key: tab.value, value: tab.value, className: "rw-react-tabs-trigger" },
                    tab.label,
                )
            ),
        ),
        tabs.map((tab) =>
            React.createElement(
                Tabs.Content,
                {
                    key: tab.value,
                    value: tab.value,
                    forceMount: keepMounted || undefined,
                    hidden: keepMounted && value !== tab.value,
                    className: "rw-react-tabs-content",
                },
                tab.children,
            )
        ),
    );
}
