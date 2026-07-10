// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import React from "react";
import { CodeReviewSurface } from "./CodeReviewSurface.tsx";
import { PlanReviewSurface } from "./PlanReviewSurface.tsx";

const PLAN_FIXTURE = `# Fixture Plan Review

This fixture proves the Astro/React Workspace can host a Plannotator-style document for visual review iteration.

## Scope

- Decisions log to console in dev mode.
- The left sidebar contains Contents only.
- The right sidebar contains annotations and feedback.
`;

const CODE_REVIEW_FIXTURE = `diff --git a/src/example.js b/src/example.js
index 1111111..2222222 100644
--- a/src/example.js
+++ b/src/example.js
@@ -1,3 +1,5 @@
 export function greet(name) {
+    if (!name) return "Hello, RunWield";
     return \`Hello, \${name}\`;
 }
`;

export function ReviewDevSurface({ surface }) {
    const isPlan = surface === "plan";
    const payload = isPlan ? { plan: PLAN_FIXTURE, token: "dev-plan-review", mode: "dev" } : {
        rawPatch: CODE_REVIEW_FIXTURE,
        gitRef: "fixture-review",
        agentCwd: "workspace-dev",
        token: "dev-code-review",
        mode: "dev",
    };

    return React.createElement(
        "section",
        { className: "review-dev-surface", "data-review-dev-surface": surface },
        React.createElement(
            "div",
            { className: "page-header" },
            React.createElement("p", { className: "eyebrow" }, "Internal Workspace HMR entrypoint"),
            React.createElement("h2", null, isPlan ? "Plan Review Dev Surface" : "Code Review Dev Surface"),
            React.createElement(
                "p",
                null,
                "This route uses local fixtures and logs decisions instead of posting workflow API calls.",
            ),
        ),
        isPlan
            ? React.createElement(PlanReviewSurface, { payload })
            : React.createElement(CodeReviewSurface, { payload }),
    );
}
