---
planId: "584d0b85-8b6a-47b3-850f-9dd30d275679"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-human-review.ts"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/ui/review/"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/workspace-code-review.integration.test.ts"
    - "src/ui/workspace/workspace-plan-review-ux.test.tsx"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev/code-review"
devServerHmr: true
createdAt: "2026-09-01"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "dee1a319-065d-4a51-b87e-8e6bc99e44dd"
    path: "docs/work-records/2026-09-02-code-review-header-shows-plan-title.md"
    lastAttemptAt: "2026-09-02T01:29:41.500Z"
targetBranch: "main"
---

# Show the Plan Title in the Code Review Header

## Context

Code Review currently shows the RunWield logo followed by the heading `Code Review`. A reviewer cannot see which Plan
produced the changes without looking elsewhere on the page. The requested header is visually
`W. Code Review - <Plan
title>`, where the existing logo supplies `W.`.

The Plan markdown is the source of the human-readable title. The first level-one heading supplies the display value. If
that heading is absent or empty, Code Review uses the Plan filename (`planName`). This behavior must be the same in the
standalone RunWield Core review and the live RunWield Workspace review.

## Objective

Show `Code Review - <Plan title>` beside the existing RunWield logo in every Code Review header. Preserve the full title
for assistive technology and pointer access, while long titles truncate visually so the Approve action remains visible.

## Approach

Project one explicit `planTitle` value when the human Code Review interaction is created, then preserve that value
through both review launch paths. The browser component displays the value but does not parse Plan markdown or become
the source of truth for Plan identity.

```text
Plan markdown: first `#` heading, else planName
  validation-human-review interaction metadata: planTitle
    TUI adapter -> runCodeReview -> startCodeReviewSurface -> standalone payload
    Workspace continuation -> live Code Review route payload
      CodeReviewSurface -> logo + "Code Review - <planTitle>"
```

Keep the existing logo, toolbar, heading element, options menu, and approval controls. Add only title projection,
formatting, and Code Review-specific overflow rules. Reuse the existing review toolbar typography and semantic design
tokens; this change does not introduce a new design-system pattern.

The set-aside option is to send the full Plan markdown to each browser path and derive the title in React. That would
make display code interpret Plan content and would expose more data than this heading needs.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/validation-human-review.ts` — derive the Code Review display title from canonical Plan content
  and include it in the Code Review interaction metadata.
- `src/ui/tui/runtime-interaction-adapter.js` — preserve `planTitle` when a local interaction launches browser Code
  Review.
- `src/ui/review/code-review.ts` and `src/ui/review/review-launcher.ts` — carry the explicit title through the
  standalone launcher contract and serialized review payload.
- `src/ui/workspace/server/session-continuation.js` — preserve the title in the safe live-interaction projection used by
  the Workspace Code Review route.
- `src/ui/workspace/react/review-types.ts` and `src/ui/workspace/react/CodeReviewSurface.tsx` — declare and render the
  title in the shared Code Review body.
- `src/ui/workspace/react/plannotator.css` — constrain only the Code Review heading so long titles ellipsize before they
  displace toolbar actions.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — give the Code Review fixture a realistic title, including a long-title
  case suitable for responsive browser checks.
- Existing validation, launcher, Workspace Code Review, and review-toolbar tests — prove title selection, transport,
  rendering, and action-safe overflow without replacing existing header-placement coverage.

`docs/domain-language.md` does not change. “Plan,” “Code Review,” RunWield Core, and RunWield Workspace already have
canonical definitions, and this change introduces no new domain term.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/validation-publication.ts` — follow its `firstMarkdownHeading` rule: only a non-empty `#` heading
  is a title, and `planName` is the fallback. Share or mirror this small rule without importing the publication module
  into UI code.
- `src/ui/workspace/react/CodeReviewSurface.tsx` — retain the current `.rw-plan-review-heading`, decorative logo, and
  semantic `h1` structure.
- `src/ui/workspace/react/plannotator.css` — extend the current toolbar and heading layout with Code Review-scoped flex,
  `min-width`, overflow, and text-ellipsis behavior.
- `src/ui/workspace/react/ReviewDevSurface.tsx` and `/dev/code-review` — use the established Surface Lab fixture instead
  of adding a new development route or launch task.

## Implementation Steps

- The human Code Review interaction metadata contains a trimmed `planTitle` equal to the first non-empty level-one Plan
  heading with its `#` marker removed. A `##` heading does not qualify. When no qualifying heading exists, the value is
  the trimmed `planName`.
- The local TUI Code Review path preserves `planTitle` through `runCodeReview` and `startCodeReviewSurface`; the real
  standalone review server payload exposes the same value rather than reconstructing it from `gitRef`.
- The Workspace continuation safe projection preserves only the derived title needed by the header, and the live Session
  Code Review route passes it to the shared surface without sending Plan markdown solely for this feature.
- `CodeReviewOptions` and the relevant launcher interfaces declare `planTitle` as a named string field. Existing
  development or defensive payload handling has a stable fallback (`planName`, then `Code changes`) so an incomplete
  payload never renders `undefined` or a trailing separator.
- `CodeReviewSurface` renders one accessible heading whose full text is `Code Review - <resolved title>`. The existing
  decorative RunWield logo remains immediately before it and no literal second `W.` is added.
- A long title remains present in the heading text and its native hover title, but visually ellipsizes within the Code
  Review heading area. The options menu, logo, and Approve action do not shrink, overlap, wrap off the toolbar, or
  become unreachable at supported desktop widths.
- The Code Review development fixture supplies a realistic Plan title and supports checking both normal and long title
  behavior in the standalone and Workspace presentations.
- Automated coverage proves: heading selection prefers the first `#` heading over `planName`; missing headings fall back
  to `planName`; the standalone server and Workspace live-review projection retain `planTitle`; and the shared surface
  uses that value in the exact heading format while preserving the existing menu/logo/action order.

## Approval Confirmation

This Plan does not supersede a Work Record.

## Verification Plan

- Automated targeted tests:
  `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-human-review.test.js src/ui/review/code-review.test.ts src/ui/review/review-launcher.test.ts src/ui/workspace/workspace-code-review.integration.test.ts src/ui/workspace/workspace-plan-review-ux.test.tsx`
- Automated project checks: `deno task check`, `deno task seams:check`, then `deno task test`.
- The title-selection test must use different heading and filename values, such as heading `Readable Plan Title` and
  `planName: "filename-fallback"`. It must fail if the implementation ignores Plan content, always shows the filename,
  accepts a `##` heading, or returns a placeholder.
- The transport tests must inspect the real interaction or server payload and assert the expected `planTitle`. They must
  fail if any adapter drops the field even when the React source still contains title-formatting code.
- The UI regression test must retain the established order: options menu, decorative logo, heading on the left, and
  Approve on the right. It must assert the exact `Code Review - <title>` formatting and Code Review-scoped overflow
  contract rather than only checking that the word `planTitle` exists in source.
- Manual headed-browser checks with `deno task workspace:dev`:
  1. Open `http://127.0.0.1:5173/dev/code-review` in an isolated headed `agent-browser` session at 1440×1000. Confirm
     the visible header is the logo followed by `Code Review - <fixture Plan title>` and that the full heading appears
     in the accessibility snapshot.
  2. Open `http://127.0.0.1:5173/dev/workspace/code-review` and confirm the in-Workspace presentation shows the same
     title and header order.
  3. Use the long-title fixture at a constrained desktop width (about 900px). Confirm the title ellipsizes, its full
     value remains available through the heading title/accessibility text, and the Approve and options controls remain
     visible and operable without overlap or horizontal toolbar overflow.
  4. Capture desktop and constrained-width screenshots. Check `agent-browser errors` and `agent-browser console`; no new
     hydration, rendering, or CSS errors are acceptable.
- Existing behavior that must remain protected: approval and feedback submission, options-menu placement, the decorative
  logo, review context bar, file/annotation panels, and shared standalone/Workspace Code Review bodies. No existing
  behavior is expected to stop.

## Edge Cases & Considerations

- A Plan can have YAML Front Matter before its title. Title selection scans the complete markdown and accepts only a
  line that starts with `#` after front matter; it does not use the front matter summary or `gitRef` as the title.
- Whitespace around the heading text and filename fallback is removed. An empty `#` line is ignored.
- Heading text is displayed as plain text through React. Markdown punctuation in an unusual title is not rendered as
  HTML and cannot inject markup.
- Long unbroken titles must ellipsize within the heading region. Do not solve overflow by hiding or moving the Approve
  action.
- The Code Review title is a projection. Plan markdown remains the authority, and changing the displayed payload does
  not mutate Plan content or lifecycle state.
- The worktree already contains an unrelated modification to `docs/plans/expose-guided-review-runtime-usage.md`.
  Execution must not overwrite or fold that change into this Plan.
