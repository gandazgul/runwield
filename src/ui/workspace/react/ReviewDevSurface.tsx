// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import React from "react";
import { CodeReviewSurface } from "./CodeReviewSurface.tsx";
import { PlanReviewSurface } from "./PlanReviewSurface.tsx";

const PLAN_FIXTURE = `---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Fixture test plan for exercising every Plan Review UI interaction"
affectedPaths:
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/react/plannotator.css"
frontend: true
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://127.0.0.1:5173/dev/plan-review"
devServerHmr: true
worktreeBaseBranch: "fixture/plan-review-ui"
createdAt: "2026-07-13T14:00:00.000Z"
status: "draft"
---

# Fixture Test Plan: Plan Review UI

## Context

This is a fixture test plan for exercising the complete Plan Review UI. Lorem ipsum dolor sit amet, consectetur
adipiscing elit. Integer nec odio praesent libero, sed cursus ante dapibus diam, sed nisi nulla quis sem at nibh
elementum imperdiet duis sagittis ipsum.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent mauris fusce nec tellus sed augue semper porta.
Mauris massa vestibulum lacinia arcu eget nulla, class aptent taciti sociosqu ad litora torquent per conubia nostra.

## Objective

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur sodales ligula in libero sed dignissim lacinia nunc.
Curabitur tortor pellentesque nibh, aenean quam in scelerisque sem at dolor maecenas mattis.

- Lorem ipsum dolor sit amet, consectetur adipiscing elit.
- Sed dignissim lacinia nunc, curabitur tortor pellentesque nibh.
- Aenean quam in scelerisque sem at dolor maecenas mattis.
- Sed convallis tristique sem, proin ut ligula vel nunc egestas porttitor.

## Approach

Lorem ipsum dolor sit amet, consectetur adipiscing elit. In hac habitasse platea dictumst morbi vestibulum volutpat
enim. Aliquam erat volutpat nam dui mi tincidunt quis accumsan porttitor facilisis luctus metus.

Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Morbi lectus risus iaculis vel suscipit quis luctus non massa.
Fusce ac turpis quis ligula lacinia aliquet, mauris ipsum nulla metus varius laoreet.

- Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.
- Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
- Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
- Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

## Files to Modify

- \`src/ui/workspace/react/PlanReviewSurface.tsx\` — Lorem ipsum dolor sit amet, consectetur adipiscing elit.
- \`src/ui/workspace/react/ReviewDevSurface.tsx\` — Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
- \`src/ui/workspace/react/plannotator.css\` — Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
- \`src/ui/workspace/routes/api/review-handlers.js\` — Duis aute irure dolor in reprehenderit in voluptate velit esse.
- \`deno.json\` — Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- \`third_party/plannotator/packages/ui/components/Viewer.tsx\` — Lorem ipsum dolor sit amet, consectetur adipiscing elit.
- \`third_party/plannotator/packages/ui/components/AnnotationToolstrip.tsx\` — Sed do eiusmod tempor incididunt ut labore.
- \`third_party/plannotator/packages/ui/components/sidebar/SidebarContainer.tsx\` — Ut enim ad minim veniam quis nostrud.
- \`third_party/plannotator/packages/ui/utils/parser.ts\` — Duis aute irure dolor in reprehenderit in voluptate velit.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec quam felis ultricies nec pellentesque eu pretium quis
sem. Nulla consequat massa quis enim donec pede justo fringilla vel aliquet nec vulputate eget arcu.

## Implementation Steps

- [ ] Step 1: Lorem ipsum dolor sit amet, consectetur adipiscing elit, integer nec odio praesent libero.
- [ ] Step 2: Sed cursus ante dapibus diam, sed nisi nulla quis sem at nibh elementum imperdiet.
- [ ] Step 3: Duis sagittis ipsum praesent mauris fusce nec tellus sed augue semper porta.
- [ ] Step 4: Mauris massa vestibulum lacinia arcu eget nulla class aptent taciti sociosqu ad litora.
- [ ] Step 5: Curabitur sodales ligula in libero sed dignissim lacinia nunc curabitur tortor.
- [ ] Step 6: Pellentesque nibh aenean quam in scelerisque sem at dolor maecenas mattis.
- [ ] Step 7: Sed convallis tristique sem proin ut ligula vel nunc egestas porttitor morbi lectus risus.
- [ ] Step 8: Iaculis vel suscipit quis luctus non massa fusce ac turpis quis ligula lacinia aliquet.

## Verification Plan

- Automated: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.
- Manual: Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
- Expected: Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
- Headed browser: Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam nec ante sed lacinia urna non tincidunt mattis tortor neque
adipiscing diam a cursus ipsum ante quis turpis nulla facilisi ut fringilla suspendisse potenti.

## Edge Cases & Considerations

- Lorem ipsum dolor sit amet, consectetur adipiscing elit, integer nec odio praesent libero sed cursus ante dapibus.
- Sed nisi nulla quis sem at nibh elementum imperdiet duis sagittis ipsum praesent mauris fusce nec tellus.
- Mauris massa vestibulum lacinia arcu eget nulla class aptent taciti sociosqu ad litora torquent per conubia.
- Curabitur sodales ligula in libero sed dignissim lacinia nunc curabitur tortor pellentesque nibh aenean quam.
- Sed convallis tristique sem proin ut ligula vel nunc egestas porttitor morbi lectus risus iaculis vel suscipit.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum lacinia arcu eget nulla class aptent taciti sociosqu
ad litora torquent per conubia nostra per inceptos himenaeos curabitur sodales ligula in libero.
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

    return isPlan
        ? React.createElement(PlanReviewSurface, { payload })
        : React.createElement(CodeReviewSurface, { payload });
}
