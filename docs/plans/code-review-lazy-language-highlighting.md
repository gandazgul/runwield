---
planId: "f9164a69-018d-4287-9ae0-8178d5cb5974"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Make the Workspace code review surface resolve Shiki grammars itself, on demand, and fall back to plain text so a file can never render blank."
affectedPaths:
    - "src/ui/workspace/react/code-review-highlighting.ts"
    - "src/ui/workspace/react/CodeReviewSurface.tsx"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/code-review-highlighting.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/ui/workspace/code-review-highlighting.test.ts && deno run -A scripts/run-tests.js -A --no-check src/ui/workspace/code-review-highlighting.test.ts"
      rationale: "The test file does not exist in the execution tree, so this exits 1. It exits 0 only when the new module exists and the test proves, against the real @pierre/diffs, that prepared grammars land in Pierre's ResolvedLanguages cache and that an unresolvable grammar falls back to \"text\". An empty or stub module fails the hasResolvedLanguages assertion."
    - id: "OC2"
      command: "grep -q \"useCodeReviewHighlighting\" src/ui/workspace/react/CodeReviewSurface.tsx"
      rationale: "The review surface does not reference the readiness hook in the execution tree, so this exits 1. It exits 0 only when the surface is actually wired to grammar preparation. Without it, a correct module could pass OC1 and never reach the rendered surface."
    - id: "OC3"
      command: "grep -q 'diff --git a/[^ ]*\\.tsx ' src/ui/workspace/react/ReviewDevSurface.tsx && grep -q 'diff --git a/[^ ]*\\.jsx ' src/ui/workspace/react/ReviewDevSurface.tsx"
      rationale: "The dev fixture patch contains only .md and .js files, so this exits 1. It exits 0 only when the fixture carries both a .tsx and a .jsx file, which is what makes the browser verification able to observe the reported defect at all."
objectiveChecksBaseline:
    recordedAt: "2026-08-11T04:16:04.785Z"
    head: "81801f44ea575a02ccc3a7b0ce80fef99a34d577"
    results:
        - id: "OC1"
          command: "test -f src/ui/workspace/code-review-highlighting.test.ts && deno run -A scripts/run-tests.js -A --no-check src/ui/workspace/code-review-highlighting.test.ts"
          rationale: "The test file does not exist in the execution tree, so this exits 1. It exits 0 only when the new module exists and the test proves, against the real @pierre/diffs, that prepared grammars land in Pierre's ResolvedLanguages cache and that an unresolvable grammar falls back to \"text\". An empty or stub module fails the hasResolvedLanguages assertion."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 18
          output: "\n"
        - id: "OC2"
          command: "grep -q \"useCodeReviewHighlighting\" src/ui/workspace/react/CodeReviewSurface.tsx"
          rationale: "The review surface does not reference the readiness hook in the execution tree, so this exits 1. It exits 0 only when the surface is actually wired to grammar preparation. Without it, a correct module could pass OC1 and never reach the rendered surface."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 17
          output: "\n"
        - id: "OC3"
          command: "grep -q 'diff --git a/[^ ]*\\.tsx ' src/ui/workspace/react/ReviewDevSurface.tsx && grep -q 'diff --git a/[^ ]*\\.jsx ' src/ui/workspace/react/ReviewDevSurface.tsx"
          rationale: "The dev fixture patch contains only .md and .js files, so this exits 1. It exits 0 only when the fixture carries both a .tsx and a .jsx file, which is what makes the browser verification able to observe the reported defect at all."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 14
          output: "\n"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev:code-review"
devServerUrl: "http://127.0.0.1:5173/dev/code-review"
devServerHmr: true
createdAt: "2026-08-11T00:04:21-04:00"
updatedAt: "2026-08-11T04:55:43.847Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-11T04:37:11.477Z"
verifiedAt: "2026-08-11T04:55:13.106Z"
userVerifiedAt: null
executionReport: "- Implemented lazy code-review grammar preparation in `src/ui/workspace/react/code-review-highlighting.ts`; it resolves Pierre/Shiki languages for current diff paths, never rejects, and falls failed grammars back to `text`.\n- Wired `CodeReviewSurface.tsx` to wait for `useCodeReviewHighlighting` before rendering all-files and Guided Review diff blocks, with existing `.rw-empty-diff` readiness text.\n- Expanded the dev code-review fixture with `.tsx`, `.jsx`, `.java`, and `.cpp` files; Java/C++ are real lazy-loaded languages outside the old preload set.\n- Added `src/ui/workspace/code-review-highlighting.test.ts`; 1 new test file, no tests removed or replaced.\n- Repaired `deno task workspace:test` path in `deno.json` from missing `src/cmd/plans/ui.test.js` to existing `src/cmd/plans/ui.test.ts`.\n- Verification passed: objective checks; `deno run -A scripts/run-tests.js -A --no-check src/ui/workspace/code-review-highlighting.test.ts`; `deno task workspace:test`; `deno task ci` passed with 260 files passed, 0 failed.\n- Browser verified headed at `http://127.0.0.1:5174/dev/code-review` (server used 5174 because 5173 was occupied), viewport 1440x1000: TSX/JSX/Java/C++ fixture diffs rendered, split and unified styles rendered, Guided Review embedded diff blocks rendered.\n- Browser diagnostics: `agent-browser errors` showed no errors; console showed only Vite/React DevTools messages; failed fetch/XHR 400-599 check showed no captured failures.\n- Visual evidence saved: `artifacts/code-review-lazy-languages-bottom.png`, `artifacts/code-review-unified-lazy-languages.png`, `artifacts/code-review-guided-lazy-languages.png`.\n- Unresolved blockers: none."
workRecord:
    status: "generated"
    recordId: "0d007d7a-5c3c-4832-a379-3d2e35511237"
    path: "docs/work-records/2026-08-11-code-review-diff-highlighting-no-longer-blanks-lazy-languages.md"
    lastAttemptAt: "2026-08-11T04:55:36.056Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "26a9ed56064a553e0474c4eb67331474942ae9d3"
    targetBranch: "main"
    targetHeadBeforeMerge: "81801f44ea575a02ccc3a7b0ce80fef99a34d577"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Code review surface: own the syntax grammar lifecycle

## Context

A person opened a Local Human Code Review in the Workspace browser UI. A `.tsx` file in the diff did not display. A
`.jsx` file failed the same way. A temporary fix that maps the `jsx` extension onto the `javascript` grammar removes one
symptom. It does not remove the defect.

That temporary fix exists only as untracked scratch files in the reporter's local checkout
(`src/ui/workspace/react/code-review-language-overrides.ts`, `src/ui/workspace/code-review-highlighting.test.js`, and an
uncommitted edit to `CodeReviewSurface.tsx`). It is **not committed**, so the execution tree does not contain it. Do not
recreate it, and do not carry any part of it forward.

The defect is verified in the vendored renderer source:

1. The Workspace code review surface never mounts a Pierre worker pool. `ReviewWorkerPoolProvider`
   (`third_party/plannotator/packages/review-editor/workerPool.tsx`) is not imported by any file under `src/`, and
   `deno.json` maps `@pierre/diffs/worker/worker.js` to a no-op shim. `useIsWorkerPoolReadyOrDisabled` returns `true`
   when no pool exists, so every file is highlighted on the main thread.
2. The main-thread renderers start grammar loading with no rejection handler.
   `node_modules/@pierre/diffs/dist/renderers/DiffHunksRenderer.js:161` calls `this.initializeHighlighter()` as a
   floating promise, and `:240` calls `this.asyncHighlight(diff).then(...)` with no `.catch`. `FileRenderer.js:87` and
   `:176` do the same.
3. When that promise rejects, `renderCache.result` stays `null`, `processDiffResult` is skipped, and the render returns
   `undefined`. The file renders as nothing. No code path retries it. The only trace is an unhandled promise rejection
   in the browser console.
4. RunWield owns no control point for grammar selection on this surface. The only preload list lives in
   `workerPool.tsx`, which this surface does not use.
5. The dev fixture patch in `src/ui/workspace/react/ReviewDevSurface.tsx` contains only `.md` and `.js` files. No test
   and no dev route exercises a second grammar, so the defect was invisible to the suite.

An earlier note in the planning conversation listed many extensions as likely to crash the same way. Source evidence
does not support that list. Pierre's `EXTENSION_TO_FILE_FORMAT` maps `.yml` to `yml`, `.sh` to `zsh`, `.h` to
`objective-cpp`, and so on. Each of those is a real Shiki grammar and each resolves. An unmapped extension already
returns `"text"` (`getFiletypeFromFileName.js:359`). So an alias table is not the fix, and this Plan does not add one.

The grammars are already lazy. Pierre calls Shiki's `bundledLanguages`, which is a map of dynamic import functions, so
Rollup emits one chunk per grammar. Nothing is downloaded until a grammar is requested. The bundle does not need to
grow, and this Plan must not add an eager preload list.

## Objective

Give the Workspace code review surface a RunWield-owned step that resolves the grammars the current diff needs, before
the vendored renderer asks for them, and that maps any grammar which fails to resolve onto `text`. After this change, a
failure to load a grammar degrades one file to readable plain text. It can never leave a file blank, whatever the cause
of the failure.

## Approach

Prepare grammars in our own code, then render.

Pierre exposes the exact seam needed. `getSharedHighlighter` calls `getResolvedOrResolveLanguage`, which returns the
cached entry synchronously when `ResolvedLanguages` already holds the grammar
(`dist/highlighter/languages/getResolvedOrResolveLanguage.js`). If we resolve every needed grammar first, the renderer
takes the synchronous branch and no unhandled promise can exist.

A new module `src/ui/workspace/react/code-review-highlighting.ts` does three things:

1. Reads the distinct grammar names the current diff needs, through Pierre's own `getFiletypeFromFileName`, so our
   answer and Pierre's answer can never disagree.
2. Calls `resolveLanguage` for each name inside a `try`/`catch`. Success warms Pierre's `ResolvedLanguages` cache.
3. On failure, calls `setCustomExtension(<key>, "text")` for the lookup key that produced the failing name, and writes
   one `console.warn`. Pierre then asks for `text`, which is always available, and that file renders as plain text.

The lookup key must mirror Pierre's own order, because `getFiletypeFromFileName` checks the whole file name first, then
a compound extension such as `component.ts`, then the simple extension (`getFiletypeFromFileName.js:349-360`). A helper
in the new module returns the first key that resolves, and that key is the one overridden.

`CodeReviewSurface` gates the diff view on that preparation, with a timeout escape hatch. This mirrors the pattern the
codebase already uses for a stalled worker pool (`POOL_READY_TIMEOUT_MS` in `workerPool.tsx`): wait, but never wait
forever. Preparation reads local chunks, so the normal wait is short. If the timeout fires, the surface renders anyway
and Pierre keeps its current behavior.

No alias layer is introduced. `.jsx` must resolve to the real `jsx` grammar, not to `javascript`. An alias would
silently downgrade JSX highlighting and would leave the blank-file defect in place for every other grammar.

## Files to Modify

- `src/ui/workspace/react/code-review-highlighting.ts` — new. Owns grammar preparation, the fallback to `text`, and the
  React hook the surface uses.
- `src/ui/workspace/react/CodeReviewSurface.tsx` — calls the preparation hook and gates the diff view on readiness.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — the dev fixture patch gains files in grammars that no current fixture
  covers, so the dev route and the browser check can exercise the defect.
- `src/ui/workspace/code-review-highlighting.test.ts` — new. Covers preparation, cache warming, and fallback.

No file is deleted by this Plan. The alias workaround is uncommitted scratch and is absent from the execution tree.

No domain-language change. This Plan introduces no new domain term and redefines none. `docs/domain-language.md` already
defines **Local Human Code Review** and this work does not change its meaning.

No design-system change. The readiness placeholder reuses the existing `.rw-empty-diff` element already present in
`CodeReviewSurface.tsx`. Do not add a new visual pattern; if one becomes necessary, that is a separate change that must
also update `docs/design-system.md`.

## Reuse Opportunities

- `@pierre/diffs` — `getFiletypeFromFileName`, `resolveLanguage`, `setCustomExtension`, `hasResolvedLanguages`. Use
  Pierre's own lookup and cache. Do not import `shiki` directly and do not keep a private list of grammar names.
- `third_party/plannotator/packages/review-editor/workerPool.tsx` — reuse the timeout-and-continue shape of
  `useIsWorkerPoolReadyOrDisabled`. Do not import it, and do not mount the worker pool as part of this change.
- `src/ui/workspace/react/CodeReviewSurface.tsx` — `parseDiffToFiles` already produces the file list; derive the grammar
  set from it. Reuse the existing `.rw-empty-diff` element for the readiness state.
- The runner form `deno run -A scripts/run-tests.js -A --no-check <file>` is confirmed to work with `@pierre/diffs`
  under Deno. Use `--no-check` for the new test; the vendored package's own types are not clean.

## Implementation Steps

- [ ] `src/ui/workspace/react/code-review-highlighting.ts` exists and exports `codeReviewLanguagesFor`,
      `prepareCodeReviewHighlighting`, and `useCodeReviewHighlighting`. It is TypeScript with named types and no `any`,
      `unknown`, or `object`, and it has no `@ts-nocheck`.
- [ ] `codeReviewLanguagesFor(paths)` returns the distinct grammar names that `getFiletypeFromFileName` gives for those
      paths, with `"text"` excluded, so a diff of only unmapped files yields an empty list.
- [ ] `prepareCodeReviewHighlighting(paths)` resolves every grammar in that list through Pierre's `resolveLanguage`, so
      `hasResolvedLanguages(codeReviewLanguagesFor(paths))` is `true` after it settles. It never rejects.
- [ ] `prepareCodeReviewHighlighting(paths)` catches a failed resolution, calls `setCustomExtension` on the same lookup
      key Pierre would use for that path, and reports the fallback in its result. After it settles,
      `getFiletypeFromFileName(path)` returns `"text"` for that path, and the result names the affected grammar.
- [ ] `useCodeReviewHighlighting(files)` returns a readiness flag that becomes `true` when preparation settles, and also
      becomes `true` after a timeout so a stalled preparation cannot hide the diff permanently.
- [ ] No file under `src/` maps one grammar name onto another. `.jsx` resolves to `jsx`, not to `javascript`.
- [ ] `src/ui/workspace/react/CodeReviewSurface.tsx` calls `useCodeReviewHighlighting` with the parsed file list and
      renders `AllFilesCodeView` — in both the all-files view and the Guided Review `GuideBlock` view — only when that
      flag is `true`. Until then it shows the existing `.rw-empty-diff` element with readiness text.
- [ ] The dev fixture patch in `src/ui/workspace/react/ReviewDevSurface.tsx` contains at least one `.tsx` file and one
      `.jsx` file with real, several-line content, in addition to the existing `.md` and `.js` files, so the dev route
      renders more than two grammars.
- [ ] `src/ui/workspace/code-review-highlighting.test.ts` covers, against the real `@pierre/diffs`: that
      `codeReviewLanguagesFor` maps `.tsx` to `tsx` and `.jsx` to `jsx`; that after `prepareCodeReviewHighlighting`,
      `hasResolvedLanguages` reports those grammars resolved; and that a path whose grammar cannot resolve maps to
      `"text"` afterwards. The fallback case uses a real unresolvable grammar name installed with `setCustomExtension`,
      not an injected fake.

## Verification Plan

Automated:

- `deno run -A scripts/run-tests.js -A --no-check src/ui/workspace/code-review-highlighting.test.ts`
- `deno task workspace:test`
- `deno task ci`

Browser, required, using `agent-browser`:

- Start `deno task workspace:dev:code-review` and open `http://127.0.0.1:5173/dev/code-review`.
- The `.tsx` fixture file and the `.jsx` fixture file each render their diff with syntax colors. Neither is blank.
  Capture a screenshot showing both.
- The existing `.md` and `.js` fixture files still render with syntax colors.
- The browser console shows no unhandled promise rejection and no `resolveLanguage` error.
- Switch the diff style between split and unified and confirm every file still renders. The surface remounts
  `AllFilesCodeView` through its `key` prop on that change, so this exercises the readiness gate a second time.
- Open the Guided Review view from the dev fixture and confirm its embedded diff blocks render the same way.

Existing coverage:

- `src/ui/workspace/workspace-review.test.js` and `src/ui/workspace/astro-config.test.js` must keep passing unchanged.
  They cover review payload handling and build configuration, neither of which this Plan changes.
- No existing test covers grammar selection on this surface, so no existing assertion has to be rewritten or retired. If
  a test asserting that `.jsx` maps to `javascript` appears in the tree, it came from the uncommitted workaround. **That
  behavior is expected to stop existing.** Do not preserve it.

## Edge Cases & Considerations

- **Bundle size.** Shiki grammars are already separate chunks reached through dynamic import. Preparation must resolve
  only the grammars the current diff contains. Adding a static preload list would download grammars nobody asked for and
  is out of scope.
- **A grammar that resolves but produces a broken render.** Out of scope. This Plan guarantees that a file always shows
  its content; it does not guarantee correct colors from a faulty grammar.
- **Large diffs with many grammars.** Preparation resolves grammars in parallel and each is a small local chunk. If a
  future measurement shows a slow first paint, the fix is to raise the readiness flag per file rather than per diff. The
  timeout escape hatch already bounds the worst case.
- **The vendored renderers keep their missing `.catch`.** `@pierre/diffs` is an installed package, not editable source.
  This Plan works around that by making the rejection impossible on our path. If Pierre later adds error handling, the
  preparation step stays correct and simply becomes redundant.
- **The worker pool stays unmounted.** Turning it on would move tokenization off the main thread and change the failure
  mode again, because `resolveLanguage` throws inside a worker by design. That is a separate performance decision and is
  not part of this fix.
- **Assumption, open to correction at review.** The surface waits for grammar preparation before showing the diff,
  rather than painting plain text first and repainting when grammars arrive. Waiting is simpler, matches the existing
  stalled-pool pattern, and avoids a full remount that would reset scroll position. The wait reads local chunks and
  should not be perceptible.
