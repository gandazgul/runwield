import React from "react";
import { PlannotatorPlanBody } from "./PlannotatorPlanBody.tsx";
import {
    RunWieldButton,
    RunWieldCard,
    RunWieldTabs,
} from "../../design-system/components/react/RunWieldPrimitives.jsx";

const PLAN_FIXTURE =
    `# Fixture Plan Review\n\nThis fixture proves the Astro/React Workspace can host a Plannotator-rendered document for visual review iteration.\n\n- Approve and feedback controls are non-production placeholders in this slice.\n- Real workflow decision transport belongs to the hosted review surface slice.\n`;

const CODE_REVIEW_FIXTURE =
    `diff --git a/src/example.js b/src/example.js\nindex 1111111..2222222 100644\n--- a/src/example.js\n+++ b/src/example.js\n@@ -1,3 +1,5 @@\n export function greet(name) {\n+    if (!name) return \"Hello, RunWield\";\n     return \`Hello, \${name}\`;\n }\n`;

type ReviewSurface = "plan" | "code";

type ReviewDevSurfaceProps = {
    surface: ReviewSurface;
};

export function ReviewDevSurface({ surface }: ReviewDevSurfaceProps) {
    const isPlan = surface === "plan";
    const title = isPlan ? "Plan Review Dev Surface" : "Code Review Dev Surface";
    const badge = isPlan ? "Fixture-backed Plan review" : "Fixture-backed code review";
    const body = isPlan ? PLAN_FIXTURE : CODE_REVIEW_FIXTURE;

    return React.createElement(
        "section",
        { className: "review-dev-surface", "data-review-dev-surface": surface },
        React.createElement(
            "div",
            { className: "page-header" },
            React.createElement("p", { className: "eyebrow" }, "Internal Workspace HMR entrypoint"),
            React.createElement("h2", null, title),
            React.createElement(
                "p",
                null,
                "This route is for browser iteration only. It uses local fixtures and does not submit workflow decisions.",
            ),
        ),
        React.createElement(
            RunWieldCard,
            { className: "review-dev-card" },
            React.createElement(
                "div",
                { className: "card-header" },
                React.createElement(
                    "div",
                    null,
                    React.createElement(
                        "p",
                        { className: "card-kicker" },
                        React.createElement("span", { className: "badge muted" }, badge),
                    ),
                    React.createElement(
                        "h3",
                        { className: "card-title" },
                        "RunWield themed React/Radix/Plannotator scaffold",
                    ),
                ),
                React.createElement(
                    "div",
                    { className: "review-dev-actions", "aria-label": "Fixture controls" },
                    React.createElement(RunWieldButton, { variant: "primary", type: "button" }, "Approve fixture"),
                    React.createElement(RunWieldButton, { type: "button" }, "Request changes"),
                ),
            ),
            React.createElement(RunWieldTabs, {
                defaultValue: "document",
                tabs: [
                    {
                        value: "document",
                        label: isPlan ? "Plan document" : "Patch",
                        children: isPlan
                            ? React.createElement(PlannotatorPlanBody, { markdown: body })
                            : React.createElement(
                                "pre",
                                { className: "review-dev-diff" },
                                React.createElement("code", null, body),
                            ),
                    },
                    {
                        value: "metadata",
                        label: "Metadata",
                        children: React.createElement(
                            "dl",
                            { className: "metadata-grid" },
                            metadataItem("Renderer", "Astro SSR + React island"),
                            metadataItem("Primitive", "Radix Tabs via RunWield wrapper"),
                            metadataItem("Theme", "Selected RunWield --rw-* variables"),
                            metadataItem("Transport", "Fixture only; workflow decisions are not wired in this slice"),
                        ),
                    },
                ],
            }),
        ),
    );
}

function metadataItem(term: string, description: string) {
    return React.createElement(
        "div",
        null,
        React.createElement("dt", null, term),
        React.createElement("dd", null, description),
    );
}
