import{R as e}from"./index.BZa3CnMo.js";import{CodeReviewSurface as o}from"./CodeReviewSurface.aMvmsWj8.js";import{P as n}from"./PlanReviewSurface.BtA6LBvK.js";import"./jsx-runtime.D_zvdyIk.js";import"./ReviewAgentsIcon.BpYE1ZGi.js";import"./index.CBz-5MBH.js";import"./preload-helper.BlTxHScW.js";/* empty css                          */const i=`# Fixture Plan Review

This fixture proves the Astro/React Workspace can host a Plannotator-style document for visual review iteration.

## Scope

- Decisions log to console in dev mode.
- The left sidebar contains Contents only.
- The right sidebar contains annotations and feedback.
`,s=`diff --git a/src/example.js b/src/example.js
index 1111111..2222222 100644
--- a/src/example.js
+++ b/src/example.js
@@ -1,3 +1,5 @@
 export function greet(name) {
+    if (!name) return "Hello, RunWield";
     return \`Hello, \${name}\`;
 }
`;function w({surface:a}){const t=a==="plan",r=t?{plan:i,token:"dev-plan-review",mode:"dev"}:{rawPatch:s,gitRef:"fixture-review",agentCwd:"workspace-dev",token:"dev-code-review",mode:"dev"};return e.createElement("section",{className:"review-dev-surface","data-review-dev-surface":a},e.createElement("div",{className:"page-header"},e.createElement("p",{className:"eyebrow"},"Internal Workspace HMR entrypoint"),e.createElement("h2",null,t?"Plan Review Dev Surface":"Code Review Dev Surface"),e.createElement("p",null,"This route uses local fixtures and logs decisions instead of posting workflow API calls.")),t?e.createElement(n,{payload:r}):e.createElement(o,{payload:r}))}export{w as ReviewDevSurface};
