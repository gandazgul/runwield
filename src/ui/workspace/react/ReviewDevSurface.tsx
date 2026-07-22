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
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
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

const CODE_REVIEW_FIXTURE = `diff --git a/src/review/feedback.js b/src/review/feedback.js
index 1111111..2222222 100644
--- a/src/review/feedback.js
+++ b/src/review/feedback.js
@@ -1,7 +1,16 @@
 export function createFeedback(annotations) {
-    return annotations.map((annotation) => annotation.text).join("\\n");
+    const sections = annotations.map((annotation) => {
+        const location = annotation.filePath
+            ? \`\${annotation.filePath}:\${annotation.lineStart}\`
+            : "Global comment";
+        return \`- \${location}: \${annotation.text}\`;
+    });
+    return sections.join("\\n");
 }
+export function collectImages(annotations) {
+    return annotations.flatMap((annotation) => annotation.images ?? []);
+}
 // Summary helper.
export function getReviewSummary(count) {
     return count === 1 ? "1 annotation" : \`\${count} annotations\`;
 }
@@ -18,8 +27,14 @@ export function getReviewSummary(count) {
-export async function submitFeedback(client, annotations) {
+export async function submitFeedback(client, annotations, approved = false) {
     const feedback = createFeedback(annotations);
-    return client.post("/feedback", { feedback });
+    const images = collectImages(annotations);
+    return client.post("/feedback", {
+        annotations,
+        approved,
+        feedback,
+        images,
+    });
 }
 // Approval helper.
-export function canApprove(annotations) {
-    return annotations.length === 0;
+export function canApprove() {
+    return true;
 }
diff --git a/src/review/feedback.test.js b/src/review/feedback.test.js
index 3333333..4444444 100644
--- a/src/review/feedback.test.js
+++ b/src/review/feedback.test.js
@@ -1,8 +1,30 @@
 import { assertEquals } from "@std/assert";
-import { createFeedback } from "./feedback.js";
+import { canApprove, collectImages, createFeedback } from "./feedback.js";
 // Review feedback tests.
-Deno.test("createFeedback joins comments", () => {
-    const result = createFeedback([{ text: "Rename this" }, { text: "Add a test" }]);
-    assertEquals(result, "Rename this\\nAdd a test");
+Deno.test("createFeedback includes inline locations", () => {
+    const result = createFeedback([{
+        filePath: "src/review/feedback.js",
+        lineStart: 12,
+        text: "Rename this",
+    }]);
+    assertEquals(result, "- src/review/feedback.js:12: Rename this");
+});
+
+Deno.test("createFeedback identifies global comments", () => {
+    const result = createFeedback([{ text: "Add a test" }]);
+    assertEquals(result, "- Global comment: Add a test");
+});
+
+Deno.test("collectImages preserves every attachment", () => {
+    const images = collectImages([
+        { images: [{ name: "first.png", path: "/tmp/first.png" }] },
+        { images: [{ name: "second.jpg", path: "/tmp/second.jpg" }] },
+    ]);
+    assertEquals(images.map((image) => image.name), ["first.png", "second.jpg"]);
+});
+
+Deno.test("approval is always available", () => {
+    assertEquals(canApprove(), true);
 });
diff --git a/src/review/image-attachments.js b/src/review/image-attachments.js
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/src/review/image-attachments.js
@@ -0,0 +1,16 @@
+const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
+
+export async function loadReviewImage(image) {
+    const bytes = await Deno.readFile(image.path);
+    if (bytes.byteLength > MAX_IMAGE_BYTES) {
+        throw new Error(\`Image exceeds \${MAX_IMAGE_BYTES} bytes\`);
+    }
+
+    return {
+        data: bytes,
+        mimeType: image.mimeType ?? "image/png",
+        name: image.name,
+        path: image.path,
+    };
+}
diff --git a/src/ui/review.css b/src/ui/review.css
index 6666666..7777777 100644
--- a/src/ui/review.css
+++ b/src/ui/review.css
@@ -1,8 +1,12 @@
 .review-layout {
     display: grid;
-    grid-template-columns: 16rem 1fr 20rem;
-    gap: 1rem;
+    grid-template-columns: 18rem minmax(0, 1fr) 22rem;
+    gap: 0;
+    min-height: 0;
 }
 /* Review toolbar. */
 .review-toolbar {
+    position: sticky;
+    top: 0;
+    z-index: 10;
     border-bottom: 1px solid var(--rw-border);
@@ -18,8 +22,12 @@
 .review-plan {
     max-width: 52rem;
-    margin: 0;
+    margin: 1rem auto 0;
+    padding: 0 1rem 4rem;
 }
 /* Right annotations rail. */
 .review-sidebar {
-    right: 1rem;
+    align-self: stretch;
+    justify-self: stretch;
+    margin: 0;
+    right: 0;
 }
diff --git a/src/review/text-labels.js b/src/review/annotation-labels.js
similarity index 72%
rename from src/review/text-labels.js
rename to src/review/annotation-labels.js
index 8888888..9999999 100644
--- a/src/review/text-labels.js
+++ b/src/review/annotation-labels.js
@@ -1,4 +1,8 @@
 export const labels = [
     "comment",
+    "issue",
+    "nitpick",
+    "praise",
+    "question",
     "suggestion",
 ];
diff --git a/src/review/legacy-dialog.js b/src/review/legacy-dialog.js
deleted file mode 100644
index aaaaaaa..0000000
--- a/src/review/legacy-dialog.js
+++ /dev/null
@@ -1,7 +0,0 @@
-export function openApprovalDialog() {
-    return {
-        requiresComment: true,
-        showCloseButton: true,
-        showDecisionDropdown: true,
-    };
-}
diff --git a/docs/code-review-fixture.md b/docs/code-review-fixture.md
index bbbbbbb..ccccccc 100644
--- a/docs/code-review-fixture.md
+++ b/docs/code-review-fixture.md
@@ -1,7 +1,15 @@
 # Code review fixture
 <!-- Fixture purpose. -->
-This fixture covers one modified JavaScript file.
+This fixture covers a representative review across several kinds of changes.
 <!-- Fixture checklist. -->
-Use it to confirm that the diff renders.
+Verify the following interactions:
+
+- Browse committed, staged, unstaged, and untracked changes.
+- Switch between the Changes list and Files tree.
+- Add inline comments on additions and deletions.
+- Add a global comment with an annotated image.
+- Change diff display settings.
+- Send every annotation with feedback or approval.
 <!-- Fixture safety note. -->
 The fixture never submits to a running agent.
diff --git a/src/review/fixture-config.js b/src/review/fixture-config.js
new file mode 100644
index 0000000..ddddddd
--- /dev/null
+++ b/src/review/fixture-config.js
@@ -0,0 +1,12 @@
+export const fixtureConfig = {
+    title: "Fixture Code Review",
+    annotations: ["inline", "global", "image"],
+    decisionActions: ["feedback", "approve"],
+    diffStyles: ["split", "unified"],
+    fileStates: ["committed", "staged", "unstaged", "untracked"],
+    layout: "edge-aligned",
+    settings: ["general", "display", "labels", "shortcuts"],
+    theme: "runwield",
+};
`;

const GUIDED_REVIEW_FIXTURE = {
    schemaVersion: "1.0",
    title: "Review feedback flow explainer",
    intent:
        "A single-column Guided Review Explainer that mixes prose, Mermaid, an exceptional widget, and live annotatable diffs.",
    sections: [
        {
            title: "Core implementation",
            role: "core",
            blocks: [
                {
                    type: "prose",
                    markdown:
                        "The feedback path now preserves richer annotation context instead of flattening comments into unstructured text.",
                },
                {
                    type: "callout",
                    tone: "review",
                    title: "Review focus",
                    markdown: "Check that image attachments and approval state survive the feedback handoff.",
                },
                {
                    type: "mermaid",
                    title: "Feedback data flow",
                    description: "How annotations move into the review payload.",
                    source:
                        "flowchart TD\n    A[Annotations] --> B[createFeedback]\n    A --> C[collectImages]\n    B --> D[submitFeedback payload]\n    C --> D",
                },
                {
                    type: "diff",
                    file: "src/review/feedback.js",
                    summary:
                        "Core payload construction now includes annotations, approval state, feedback text, and images.",
                },
            ],
        },
        {
            title: "Consequences and visual check",
            role: "ui_behavior",
            blocks: [
                {
                    type: "prose",
                    markdown:
                        "The review UI layout shifts to a more edge-aligned surface, so a quick visual model helps explain the changed spatial relationship.",
                },
                {
                    type: "widget",
                    id: "layout-widget",
                    entry: "index.html",
                    title: "Toolbar layout sandbox",
                    reason: "A tiny local-only widget demonstrates why the sticky toolbar needs more breathing room.",
                    html:
                        '<!doctype html><link rel="stylesheet" href="widget.css"><section class="demo"><button id="toggle">Toggle cramped state</button><div id="panel">Toolbar has room for review actions.</div></section><script src="widget.js"></script>',
                    assets: [
                        {
                            name: "widget.css",
                            contentType: "text/css",
                            content:
                                ".demo{font:14px system-ui;padding:16px;color:#e2e8f0;background:#0f172a}.demo.cramped #panel{max-width:140px;color:#fecaca}button{border:1px solid #38bdf8;background:#082f49;color:#e0f2fe;border-radius:8px;padding:8px}",
                        },
                        {
                            name: "widget.js",
                            contentType: "application/javascript",
                            content:
                                "document.getElementById('toggle').addEventListener('click',()=>document.querySelector('.demo').classList.toggle('cramped'));",
                        },
                    ],
                },
                {
                    type: "diff",
                    file: "src/ui/review.css",
                    summary: "Layout columns and sticky toolbar behavior changed.",
                },
            ],
        },
        {
            title: "Support tests",
            role: "support",
            blocks: [
                {
                    type: "reviewCheckpoint",
                    markdown:
                        "Confirm tests cover inline locations, global comments, image preservation, and approval availability.",
                },
                {
                    type: "diff",
                    file: "src/review/feedback.test.js",
                    summary: "Regression tests for the new feedback payload shape.",
                },
            ],
        },
    ],
    everythingElse: [
        { file: "src/review/image-attachments.js" },
        { file: "docs/code-review-fixture.md" },
    ],
    widgetAssets: [],
};

const GUIDE_DEV_VARIANTS = [
    { id: "ready", label: "Ready explainer + widget" },
    { id: "no-provider", label: "No provider available" },
    { id: "failed", label: "Failed generation" },
];

function buildCodeReviewDevPayload(variant) {
    const base = {
        rawPatch: CODE_REVIEW_FIXTURE,
        gitRef: "Fixture Code Review",
        agentCwd: "workspace-dev/fixture-code-review",
        token: `dev-code-review-${variant}`,
        mode: "dev",
        guidedReview: { mode: "auto", autoStart: false, manualAvailable: true, reasons: ["dev fixture"] },
        reviewStatus: {
            stagedFiles: ["src/review/feedback.test.js", "src/review/image-attachments.js"],
            unstagedFiles: [
                "docs/code-review-fixture.md",
                "src/review/feedback.js",
                "src/ui/review.css",
            ],
            untrackedFiles: ["src/review/fixture-config.js"],
        },
    };
    if (variant === "no-provider") {
        return {
            ...base,
            guidedReview: { ...base.guidedReview, reasons: ["dev fixture: no provider"] },
            devGuideCapabilities: { available: false, providers: [] },
        };
    }
    if (variant === "failed") {
        return {
            ...base,
            guidedReview: { ...base.guidedReview, reasons: ["dev fixture: failed generation"] },
            devGuideCapabilities: {
                available: true,
                providers: [{ id: "guide", provider: "fixture", model: "failure" }],
            },
            devGuideFailure: "Fixture provider failed while generating the Guided Review Explainer.",
        };
    }
    return {
        ...base,
        devGuideCapabilities: { available: true, providers: [{ id: "guide", provider: "fixture", model: "ready" }] },
        guidedReviewFixture: GUIDED_REVIEW_FIXTURE,
    };
}

export function ReviewDevSurface({ surface }) {
    const isPlan = surface === "plan";
    const [guideVariant, setGuideVariant] = React.useState("ready");
    const payload = isPlan
        ? { plan: PLAN_FIXTURE, token: "dev-plan-review", mode: "dev" }
        : buildCodeReviewDevPayload(guideVariant);

    if (isPlan) return React.createElement(PlanReviewSurface, { payload });

    return React.createElement(
        React.Fragment,
        null,
        React.createElement(
            "nav",
            { className: "rw-dev-fixture-switcher", "aria-label": "Guided Review dev fixtures" },
            GUIDE_DEV_VARIANTS.map((variant) =>
                React.createElement(
                    "button",
                    {
                        key: variant.id,
                        type: "button",
                        className: guideVariant === variant.id ? "active" : "",
                        onClick: () => setGuideVariant(variant.id),
                    },
                    variant.label,
                )
            ),
        ),
        React.createElement(CodeReviewSurface, { key: guideVariant, payload }),
    );
}
