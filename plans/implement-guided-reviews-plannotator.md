---
planId: "4a8f571f-4022-4dea-bc71-6a7134e11e9e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement Guided Reviews by integrating Plannotator's guide functionality into the RunWield code review surface. This involves updating the Plannotator compiled bridge or adapting source components to support agent-generated, chaptered reviews of changesets with live annotatable diffs and per-section reviewed state."
affectedPaths:
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/code-review.js"
    - "deno.json"
frontend: true
createdAt: "2026-07-07T16:24:01-04:00"
updatedAt: "2026-07-07T20:28:40.178Z"
status: "draft"
origin: "internal"
---

# Implement Guided Reviews with Plannotator

## Context

RunWield already launches human code review through the Plannotator compiled bridge:

- `runPlannotatorCodeReview()` delegates to `startCodeReviewSurface()`.
- `startCodeReviewSurface()` imports `@gandazgul/plannotator-pi-extension-compiled/server`, reads its bundled
  `review-editor.html`, starts `startReviewServer()`, and opens the resulting local URL.
- The currently installed compiled package is `@gandazgul/plannotator-pi-extension-compiled@0.22.0`; discovery confirmed
  this package already contains Plannotator's Guided Review server and client implementation (`guide` provider,
  `/api/guide/*` routes, Guide button, `Mod+Shift+G`, one-time intro, hint state, guide screen, and shared annotatable
  diff components).

Product intent comes directly from the request and Plannotator's own Guided Review ADR/spec under
`third_party/plannotator/adr/`: a Guided Review organizes any PR/local diff into importance-ordered chapters, pairs
prose and per-file summaries with live diffs, stores per-section reviewed state, and never trusts model-invented file
paths.

This plan should not port or redesign the Plannotator feature inside RunWield unless the compiled bridge proves
insufficient. The intended implementation is to make RunWield's existing review-surface integration explicitly
guide-capable, tested, and discoverable while preserving the `review-launcher.js` adapter seam from ADR-007.

## Objective

Expose Guided Reviews in the RunWield code review flow by relying on the guide-capable Plannotator compiled bridge and
adding RunWield-side guardrails:

- Keep workflow callers behind `startCodeReviewSurface()`; do not bypass the review-surface adapter.
- Ensure the bundled review editor and server expose the `guide` provider and guide routes.
- Preserve shared annotation/export behavior by using Plannotator's real review editor rather than a copied guide UI.
- Preserve server-side validation by using Plannotator's guide session implementation over the real patch/changelist.
- Improve RunWield launch messaging/tests so the Guide button and shortcut are part of the expected code review surface.

## Approach

Use the installed/published Plannotator compiled bridge as the feature implementation substrate. The engineer should
first verify that the resolved package remains guide-capable; current discovery shows `0.22.0` is guide-capable and is
also the latest published version. If execution finds an older lockfile or missing guide assets, refresh
`deno.lock`/`deno.json` to a guide-capable compiled package rather than vendoring the Plannotator source.

Then add lightweight RunWield integration checks around the existing seam:

- Keep `src/shared/workflow/review-launcher.js` as the only browser-surface launcher.
- Keep passing `agentCwd` into `startReviewServer()` so guide jobs can run in the execution worktree when agent CLIs are
  installed.
- Add/adjust tests that prove the compiled code review surface includes Guided Review support:
  - `loadReviewEditorHtml()` returns an editor bundle containing Guided Review UI affordances.
  - a real `startReviewServer()` smoke launch exposes `/api/agents/capabilities` with `guide` and exposes
    `/api/guide/:jobId` routes.
  - `runPlannotatorCodeReview()` still delegates through the seam and still passes the raw patch, git ref,
    `origin: "runwield"`, and `agentCwd` unchanged.
- Optionally update the RunWield system message when opening Plannotator code review to mention: "Use Guide or
  Mod+Shift+G for Guided Review." Keep this informational only; the Plannotator one-time intro/hint state remains owned
  by Plannotator's browser storage.

## Files to Modify

- `src/shared/workflow/review-launcher.js` — only change if needed to expose/test a guide-capable support check or
  preserve a new compiled-bridge API. Do not replace the adapter seam.
- `src/shared/workflow/review-launcher.test.js` — add an integration-style smoke test for the compiled code review
  server: launch with a tiny patch, fetch `/api/agents/capabilities`, assert the `guide` provider is present, fetch
  `/api/guide/not-real`, assert a controlled 404, then stop the server.
- `src/shared/workflow/code-review.js` — optionally add concise launch guidance that the code review UI includes Guided
  Reviews via the Guide button / `Mod+Shift+G`.
- `src/shared/workflow/code-review.test.js` — update expected launch messages if `code-review.js` messaging changes;
  keep seam delegation assertions intact.
- `deno.json` — update only if the guide-capable compiled package version/range needs to be made explicit.
- `deno.lock` — refresh only if dependency resolution changes.

## Reuse Opportunities

- `src/shared/workflow/review-launcher.js` — existing review-surface adapter and browser-opening lifecycle.
- `src/shared/workflow/code-review.js` — existing workflow code review launch and decision normalization.
- `third_party/plannotator/packages/server/guide/guide-review.ts` — reference behavior for guide prompting, file
  coverage validation, marker engine support, and reviewed-state semantics.
- `third_party/plannotator/packages/review-editor/components/guide/` — reference implementation for guide screen,
  section cards, live diffs, and annotation parity.
- `third_party/plannotator/packages/review-editor/components/GuideIntroDialog.tsx` and `utils/guideIntro.ts` — reference
  one-time intro and subtle Guide button hint semantics.

## Implementation Steps

- [ ] Step 1: Confirm the resolved compiled bridge is guide-capable before editing.
  - Check `npm view @gandazgul/plannotator-pi-extension-compiled version` and the resolved package in
    `node_modules`/`deno.lock`.
  - Confirm `review-editor.html` contains the Guide UI and `dist/server.mjs` contains `guide` provider/routes.
  - If not present, update `deno.json`/`deno.lock` to a guide-capable version; do not fork Plannotator source unless no
    compiled package can satisfy the contract.
- [ ] Step 2: Preserve and, if needed, harden the RunWield review-surface adapter.
  - Ensure `startCodeReviewSurface()` continues to call Plannotator `startReviewServer()` with `rawPatch`, `gitRef`,
    `htmlContent`, `origin: "runwield"`, and `agentCwd`.
  - Do not change `runPlannotatorCodeReview()`'s public dependency-injection shape unless tests prove a new Plannotator
    option is required.
- [ ] Step 3: Add compiled-bridge Guided Review regression coverage.
  - In `review-launcher.test.js`, start the actual compiled `startReviewServer()` through `startCodeReviewSurface()` or
    a focused helper with a minimal diff and `openInDefaultBrowser: () => Promise.resolve(false)`.
  - Fetch `/api/agents/capabilities` from the local server and assert a provider with `id: "guide"` and name
    `"Guided Review"` exists.
  - Fetch `/api/guide/not-real` and assert the route exists with a controlled `404` JSON response rather than falling
    through to HTML/static handling.
  - Always stop the server in `finally`.
- [ ] Step 4: Add UI bundle/discoverability assertions.
  - Keep or extend the `loadReviewEditorHtml()` test so it asserts the bundled review editor includes stable Guided
    Review text such as `Start a guided review?` or `Introducing Guided Reviews` if these strings survive bundling.
  - If the bundle is too minified for stable string assertions, rely on the server capability smoke test and avoid
    brittle implementation-text checks.
- [ ] Step 5: Add optional RunWield launch guidance.
  - If changing user-facing messaging, append a short system message after the review URL:
    `Guided Reviews are available from the Guide button or Mod+Shift+G.`
  - Update `code-review.test.js` expected messages.
  - Do not duplicate Plannotator's first-use dialog or hint state in RunWield.
- [ ] Step 6: Verify the actual browser flow with headed agent-browser.
  - Start a local code review surface with a sample patch from the current checkout.
  - Clear browser storage for that localhost origin for the first-use check.
  - Confirm the intro dialog, Guide button hint, Guide button, `Mod+Shift+G` shortcut, engine/model picker, and guide
    empty/generating states render.
  - If an agent CLI is installed/authenticated, generate a small guide and verify sections, reviewed checkboxes, live
    diffs, annotation creation inside a guide diff, and feedback export parity.

## Verification Plan

- Automated:
  - `deno test -A src/shared/workflow/review-launcher.test.js src/shared/workflow/code-review.test.js`
  - `deno task check`
  - `deno task test` if the focused tests and check pass.
- Manual/browser:
  - Launch a temporary review surface from the repo root using `startCodeReviewSurface()` with a tiny real patch and
    `openInDefaultBrowser: () => Promise.resolve(false)`, or exercise the normal post-validation Plannotator code review
    path if a workflow diff is available. One workable smoke launcher is:
    ```bash
    cat > /tmp/runwield-guided-review-smoke.mjs <<'EOF'
    const launcherUrl = new URL("./src/shared/workflow/review-launcher.js", `file://${Deno.cwd()}/`).href;
    const { startCodeReviewSurface } = await import(launcherUrl);

    const server = await startCodeReviewSurface({
        rawPatch: "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n",
        gitRef: "Guided Review smoke",
        agentCwd: Deno.cwd(),
        openInDefaultBrowser: () => Promise.resolve(false),
    });

    console.log(server.url);
    await new Promise(() => {});
    EOF
    deno run -A --config deno.json /tmp/runwield-guided-review-smoke.mjs
    ```
  - Open the printed local URL with `agent-browser --headed` in a separate terminal/session, then stop the smoke
    launcher when finished.
  - Clear site storage for the local review URL and reload.
  - Expected first open: one-time "Introducing Guided Reviews" dialog appears, can be dismissed, and the Guide button
    carries the subtle hint until first use.
  - Expected entry points: clicking Guide or pressing `Mod+Shift+G` opens Guided Review mode.
  - Expected launch controls: engine/model picker includes available installed engines; Claude/Codex native and
    Cursor/OpenCode/Pi/Copilot marker engines appear only when installed/available.
  - Expected generation: with an installed/authenticated engine, generating creates importance-ordered sections with
    prose overview, per-file summaries, and live diffs. Every changed file is either in exactly one section or in
    "Everything else".
  - Expected annotation parity: annotating a line inside a guide diff adds to the same review annotation state and
    appears in the normal feedback/export path.
  - Expected reviewed state: checking a section marks/collapses it; reload within the same server process preserves the
    reviewed array.
- Frontend note:
  - There is no long-running HMR dev server for this compiled review surface; each review launch starts an ephemeral
    local Plannotator server. That is why `devServerCommand`, `devServerUrl`, and `devServerHmr` are `null`.

## Edge Cases & Considerations

- The current compiled bridge already appears to include Guided Review. Treat this as an integration/hardening slice,
  not a source-porting slice.
- If the guide-capable package changes API shape, update `review-launcher.js` behind the existing adapter and add tests
  for the new options.
- Do not create a separate RunWield intro/hint state; Plannotator owns `plannotator-guide-intro-seen` and
  `plannotator-guide-hint-acked` browser storage.
- Server-side guide validation must remain Plannotator-owned and fail closed: fabricated file paths should not surface
  as diffs, and every real changed file must be accounted for by sections or unplaced files.
- Guide generation availability depends on installed/authenticated agent CLIs. Browser verification may need to record
  "generation blocked by missing engine" separately from UI integration failure.
- Keep non-Workspace RunWield files pure `.js` with JSDoc. Do not introduce TypeScript syntax outside existing
  third-party or Workspace exception zones.
