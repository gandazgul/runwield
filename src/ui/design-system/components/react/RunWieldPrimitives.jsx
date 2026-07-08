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
    return React.createElement("button", { ...props, className: classNames([variantClass, className]) }, children);
}

/**
 * @param {{ className?: string, children?: any, [key: string]: any }} props
 */
export function RunWieldCard({ className, children, ...props }) {
    return React.createElement("article", { ...props, className: classNames(["plan-card", className]) }, children);
}

/**
 * @param {{ defaultValue: string, tabs: Array<{ value: string, label: string, children: any }> }} props
 */
export function RunWieldTabs({ defaultValue, tabs }) {
    return React.createElement(
        Tabs.Root,
        { defaultValue, className: "rw-react-tabs" },
        React.createElement(
            Tabs.List,
            { className: "tabs", "aria-label": "Review sections" },
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
                { key: tab.value, value: tab.value, className: "rw-react-tabs-content" },
                tab.children,
            )
        ),
    );
}
