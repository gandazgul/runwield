// @ts-nocheck: Workspace is the scoped TSX exception zone and the pinned Plannotator checkout uses TS syntax.

import React from "react";
import { renderMarkdown } from "../components/MarkdownView.jsx";

export function PlannotatorPlanBody({ markdown }) {
    const html = renderMarkdown(markdown || "");
    if (!html) {
        return React.createElement(
            "div",
            { className: "markdown-view plannotator-plan-body", "data-plannotator-renderer": "empty" },
            React.createElement("p", { className: "empty" }, "No Plan body content."),
        );
    }

    return React.createElement("div", {
        className: "markdown-view plannotator-plan-body",
        dangerouslySetInnerHTML: { __html: html },
    });
}
