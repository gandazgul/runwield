---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Render completed Mermaid fences in Agent responses as compact inline Unicode diagrams in the TUI and guide Planner and Architect toward narrow, top-to-bottom diagrams."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/ui/tui/mermaid-markdown.js"
    - "src/ui/tui/mermaid-markdown.test.js"
    - "src/ui/tui/blocks.js"
    - "src/ui/tui/blocks.test.js"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
frontend: false
createdAt: "2026-07-21T13:07:03-04:00"
updatedAt: "2026-07-21T18:37:20.053Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-21T18:10:09.481Z"
verifiedAt: "2026-07-21T18:37:20.053Z"
executionReport: "- Implemented `MermaidMarkdown` with `beautiful-mermaid` Unicode rendering, top-level completed-fence interception, ANSI-aware width fallback, per-source caching, and upstream Markdown delegation.\n- Wired Agent TUI messages to use `MermaidMarkdown` and added focused renderer plus `AgentMessageBlock` integration coverage.\n- Updated Planner and Architect Mermaid guidance for narrow, top-to-bottom, terminal-readable diagrams.\n- Verified `renderMermaidASCII` import/dependency via Deno lock refresh; `deno test -A src/ui/tui/mermaid-markdown.test.js src/ui/tui/blocks.test.js` passed.\n- Full quality gate passed: `deno task ci` (1414 tests, check/lint/fmt/test/release smoke all clean; only existing build warnings emitted).\n- Manual TUI checks: launched `deno task cli` successfully; exercised `AgentMessageBlock` rendering by script for partial stream source fallback, completed flowchart Unicode, sequence/state/class/ER diagrams, malformed fallback, and narrow-width fallback."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Render Mermaid Diagrams in the TUI

## Context

Planner and Architect sometimes use fenced Mermaid diagrams while explaining a proposed Plan or asking the user to
choose between designs. The TUI currently passes every Agent response directly to `pi-tui`'s generic `Markdown`
component, so a `mermaid` fence appears as source code rather than a diagram. That makes otherwise useful visual models
harder to read during the collaborative conversation.

Mermaid source must remain the canonical representation in the Session Transcript and resulting Plan. Plannotator
already renders Plan Mermaid fences with source toggling, zoom, pan, fit-to-view, and fullscreen after the Plan enters
browser review. This feature therefore needs only a simple terminal presentation: compact inline Unicode with a safe
source fallback, not terminal images, navigation controls, generated HTML, or another browser surface.

## Objective

Render completed, top-level Mermaid fences in TUI Agent messages as compact Unicode diagrams when the result fits the
current terminal width. Preserve streaming and ordinary Markdown behavior, retain the original Mermaid source for replay
and browser review, and show the original fenced source whenever rendering is incomplete, invalid, unsupported, or too
wide. Guide Planner and Architect to favor focused, top-to-bottom diagrams that remain readable without zoom or panning.

## Approach

Add `beautiful-mermaid` as the terminal renderer and isolate it behind a RunWield-owned `MermaidMarkdown` component.
Subclass the current `pi-tui` `Markdown` component and override its runtime token-rendering seam so all existing
Markdown parsing, streaming, wrapping, styling, and spacing remain upstream behavior. Intercept only completed,
top-level code tokens whose normalized fence language is `mermaid`; nested fences, partial streams, and every other
token continue through the upstream renderer unchanged. Keep the private upstream override localized and protected by
equivalence and streaming tests so a future `pi-tui` change fails visibly.

Render through `renderMermaidASCII()` synchronously with Unicode enabled, ANSI colors disabled, and one fixed compact
spacing profile. Apply the existing RunWield Markdown code-block theme to the resulting lines. Measure the rendered
lines with ANSI-aware terminal width utilities before returning them; if any line exceeds the token's available width,
or rendering throws or returns no useful output, delegate the original token back to upstream Markdown. Cache renderer
results by Mermaid source so subsequent streaming deltas and terminal resizes do not repeatedly lay out completed
diagrams. Terminal resize should only re-evaluate whether cached output fits; it must never wrap, clip, or rewrite the
diagram.

Use this component for `AgentMessageBlock` regardless of Agent identity so rendering remains a content capability of the
TUI rather than an Agent-specific branch. Only Planner and Architect prompts need guidance as the intended producers.
Keep the full Mermaid fence in the Runtime message and Session Transcript; this is a presentation-only TUI change and
must not alter Agent Session events, replay contracts, or Plan content.

## Files to Modify

- `deno.json` — add the `beautiful-mermaid` npm import used by the terminal renderer.
- `deno.lock` — record the direct dependency resolution produced by the Deno dependency update.
- `src/ui/tui/mermaid-markdown.js` — implement completed-fence detection, top-level token interception, compact Unicode
  rendering, source-result caching, ANSI-aware fit checks, RunWield styling, and upstream source fallback.
- `src/ui/tui/mermaid-markdown.test.js` — add focused rendering, streaming, width, fallback, cache, nesting, resize, and
  upstream-Markdown equivalence coverage.
- `src/ui/tui/blocks.js` — replace the generic Markdown instance in `AgentMessageBlock` with `MermaidMarkdown` while
  preserving its existing streaming `setText`, invalidation, Agent heading, and spacing behavior.
- `src/ui/tui/blocks.test.js` — retain current Agent-message invariants and add an integration assertion that a
  completed Mermaid fence renders as Unicode through the real message block.
- `src/agent-definitions/planner.md` — add concise guidance for materially useful, top-level, narrow Mermaid diagrams in
  collaborative explanations and Plans.
- `src/agent-definitions/architect.md` — tighten existing Mermaid guidance with terminal-readable orientation, scope,
  fence, label, and prose requirements without duplicating the surrounding architectural policy.

## Reuse Opportunities

- `@earendil-works/pi-tui` `Markdown` — preserve the existing parser, partial-fence streaming behavior, ordinary
  Markdown rendering, theme application, wrapping, caching contract, and code-token spacing rather than replacing the
  full renderer.
- `@earendil-works/pi-tui` `visibleWidth` — perform ANSI- and Unicode-aware width checks so diagrams are never handed to
  the generic wrapping pass when they exceed the available viewport.
- `src/ui/theme/theme.js` `getMarkdownTheme()` — style diagram lines consistently with current RunWield code blocks and
  runtime theme changes instead of introducing separate colors.
- `src/ui/tui/blocks.js` `AgentMessageBlock` — keep the current incremental `appendText()` and container lifecycle; no
  Runtime or UiAPI changes are required.
- `third_party/plannotator/packages/ui/components/MermaidBlock.tsx` — rely on the existing browser Mermaid rendering and
  inspection experience after Plan creation; do not duplicate it in the TUI.

## Implementation Steps

- [ ] Step 1: Add `beautiful-mermaid` to `deno.json` and refresh `deno.lock`. Confirm the imported public
      `renderMermaidASCII` API works in Deno, retain Unicode mode with `colorMode: "none"`, and use a single compact
      spacing profile rather than user-selectable zoom levels.
- [ ] Step 2: Create `MermaidMarkdown` as a narrow adapter over `pi-tui` `Markdown`. Track token-render recursion depth,
      intercept only top-level completed backtick fences with a normalized `mermaid` language, and delegate partial,
      nested, non-Mermaid, and otherwise ineligible tokens to the upstream implementation. Isolate any JSDoc/private
      method suppression required by the upstream typings in this module.
- [ ] Step 3: Render eligible source synchronously, trim only renderer-added outer blank lines, style every diagram line
      through the current Markdown theme, and require every non-empty line to fit the supplied token width using
      `visibleWidth`. On exceptions, empty output, unsupported diagram families, or excessive width, call the upstream
      token renderer so the user receives the original fenced source without a second warning block.
- [ ] Step 4: Cache successful Unicode output and failed-render outcomes by exact Mermaid source for the lifetime of the
      message component. Reapply current theme styling and width decisions at render time so terminal resize and theme
      invalidation remain correct without recomputing diagram layout.
- [ ] Step 5: Wire `AgentMessageBlock` to `MermaidMarkdown` without filtering on Agent name. Preserve the existing Agent
      heading, incremental `setText()` calls, spacer, invalidation, replay behavior, and all non-Mermaid output.
- [ ] Step 6: Add renderer unit tests comparing non-Mermaid output with upstream `Markdown`; exercising split streaming
      deltas and partial closing fences; covering flowchart, sequence, state, class, and ER examples; and verifying
      malformed, empty, unsupported, nested, tilde-fenced, extra-info, and too-wide diagrams fall back to source.
- [ ] Step 7: Add width/resize tests proving Unicode lines are never wrapped or clipped, a diagram can switch between
      Unicode and source fallback as available width changes, multiple fences render independently, and repeated renders
      use cached layout results. Add an `AgentMessageBlock` integration test for the content-based rendering path.
- [ ] Step 8: Update Planner and Architect instructions to use completed top-level `mermaid` fences, prefer `TD` or
      otherwise top-to-bottom layouts, keep labels and participant sets small, split broad concepts into multiple
      focused diagrams, use conservative supported Mermaid syntax during TUI conversation, and explain every diagram's
      consequential point in prose.
- [ ] Step 9: Run the full quality gate and manually exercise live streaming, narrow and resized terminals, ordinary
      Markdown, Session replay, and subsequent Plannotator Plan review to confirm the source remains canonical across
      both presentation surfaces.

## Verification Plan

- Automated: run focused tests while iterating with
  `deno test -A src/ui/tui/mermaid-markdown.test.js src/ui/tui/blocks.test.js`.
- Automated: run the required complete repository gate with `deno task ci` and fix all failures, including release
  compilation checks affected by the new dependency.
- Manual: start the TUI with `deno task cli`, have an Agent stream a short top-to-bottom flowchart, and verify the
  source remains visible until the closing fence completes and then changes to a stable inline Unicode diagram.
- Manual: exercise sequence, state, class, and ER examples at normal width; verify labels and topology are readable,
  ordinary Markdown before and after each diagram is unchanged, and no diagram controls or browser links appear.
- Manual: use malformed, unsupported, nested, and intentionally wide Mermaid examples; verify each remains an ordinary
  fenced source block rather than throwing, wrapping Unicode, clipping content, or disrupting later Agent output.
- Manual: resize the terminal across the fit threshold and switch the RunWield theme; verify the component safely
  alternates between Unicode and source fallback, preserves alignment, and adopts current theme styling.
- Manual: resume a Session containing a Mermaid response and inspect a resulting Plan through Plannotator; verify replay
  rerenders from the canonical source and Plannotator retains its existing full Mermaid rendering and inspection tools.

## Edge Cases & Considerations

- `beautiful-mermaid` supports a useful Mermaid subset rather than every Mermaid diagram family or directive. Prompt
  guidance should favor flowchart, state, sequence, class, and ER diagrams for conversational use, while source fallback
  preserves unsupported content for Plannotator's full Mermaid renderer.
- Some unsupported statements within an otherwise supported family may be ignored by the renderer rather than rejected.
  Keep Agent syntax conservative and cover representative supported constructs; do not add a second Mermaid parser or
  claim full syntax equivalence in this feature.
- Vertical orientation reduces width but does not guarantee fit: sequence diagrams with many participants and class/ER
  diagrams with broad labels may still exceed the viewport. Source fallback is intentional; do not silently change
  direction, remove nodes, truncate labels, or wrap individual Unicode lines because those operations can misrepresent
  topology.
- The upstream `Markdown.renderToken()` seam is private in typings but currently dispatched dynamically at runtime.
  Localize this dependency, test ordinary-Markdown equivalence and nested recursion, and prefer a future public upstream
  code-block hook if one becomes available rather than copying the full Markdown renderer.
- Static package loading adds measurable cold-start work. Verify TUI startup and release artifact impact during
  execution; accept the simple synchronous import unless it causes a material regression, in which case return the Plan
  for a product/architecture decision rather than adding an asynchronous placeholder lifecycle implicitly.
- Rendering is synchronous and Agent-controlled. Cache by source and fall back safely on renderer errors. A source-size
  or complexity guard is not part of the agreed v1 unless verification reveals a concrete responsiveness problem.
- Reviewable assumption: Mermaid rendering is content-based across all Agent messages, although only Planner and
  Architect receive production guidance. This avoids custom-Agent and Agent-name coupling and leaves messages without
  Mermaid completely unchanged.
- No settings, persistence migration, Runtime event changes, TUI keybindings, terminal graphics protocols, zoom/pan
  overlays, HTML generation, local diagram server, or Workspace/Plannotator changes are included.
