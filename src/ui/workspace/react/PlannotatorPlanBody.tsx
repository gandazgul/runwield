// @ts-nocheck: Workspace is the scoped TSX exception zone and the pinned Plannotator checkout uses TS syntax.

import React from "react";
import { RenderedMarkdown } from "@plannotator/ui/components/RenderedMarkdown.tsx";

export function PlannotatorPlanBody({ markdown }) {
    if (!markdown.trim()) {
        return React.createElement(
            "div",
            { className: "markdown-view plannotator-plan-body", "data-plannotator-renderer": "empty" },
            React.createElement("p", { className: "empty" }, "No Plan body content."),
        );
    }

    return React.createElement(RenderedMarkdown, {
        markdown,
        className: "markdown-view plannotator-plan-body",
    });
}
