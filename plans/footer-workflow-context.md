---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Show persisted Triage Routing Intent, Complexity, and declared Plan name beside the active Agent in the TUI footer, with theme-driven workflow colors and role-aware visibility."
affectedPaths:
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session.js"
    - "src/tools/triage-report.js"
    - "src/tools/plan-written.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/theme/catppuccin-mocha.json"
    - "src/shared/session/workflow-context-session.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/tools/__tests__/triage-report.test.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/ui/theme/theme-json.test.js"
    - "src/ui/tui/chat-session.test.js"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-10T10:18:06-04:00"
updatedAt: "2026-07-10T16:10:09.056Z"
status: "feedback"
origin: "internal"
routingIntent: "FEATURE"
sessionName: "footer workflow context"
---

# TUI Footer Workflow Context

## Context

The TUI footer currently pins the active Agent Display Name to the right side of line 1, but it drops the Triage context
that selected that Agent. Users therefore cannot see whether the active Engineer is handling a QUICK_FIX or an approved
FEATURE Plan, how complex planned work was classified, or which Plan is currently being reviewed/executed.

The Triage Report already provides Routing Intent and Complexity, and the Plan-Written Tool receives the canonical Plan
name. The missing seam is Session-scoped workflow context that survives Agent changes and session resume, plus a footer
formatter that renders that context without exposing it for unrelated conversational/operational Agents.

## Objective

Extend footer line 1 from an Agent-only label to a compact, color-coded workflow label:

- `Engineer - Low Quick Fix`
- `Planner - Medium Feature`
- `Planner - Medium Feature - my-awesome-plan` after a valid `plan_written` declaration
- `Planner - my-awesome-plan` when a valid `plan_written` declaration exists without Triage context
- `Architect - High Epic` for PROJECT Triage

Only QUICK_FIX, FEATURE, and PROJECT/Epic Triage context is eligible for a colored Routing Intent label, but a valid
Plan name is independently eligible when no Triage context exists. Do not render either suffix beside Ideator, Operator,
or Guide. Show Complexity for all three eligible Routing Intents, including QUICK_FIX. Keep the active Agent name in its
existing accent color; give LOW, MEDIUM, and HIGH distinct theme-driven foreground tokens, and separately color Routing
Intent with its own theme token. The Plan name remains a lower-emphasis suffix.

This is TUI work rather than browser frontend work, so no web dev server or headed browser flow applies.

## Approach

Add a small Session-scoped workflow-context module modeled on `active-agent-session.js`. It will normalize and persist a
latest-value custom session entry containing optional Routing Intent/Complexity and optional Plan name. `HostedSession`
will hydrate that value on construction and expose narrow methods to replace context on a new Triage Report and
append/replace the Plan name after `plan_written` validates the requested Plan file. All canonical Routing Intents are
accepted for replacement/clearing semantics, while the footer only labels QUICK_FIX, FEATURE, and PROJECT.

Wire the Triage-Report Tool with the active `HostedSession` and record its normalized details before it returns. Wire
the Plan-Written Tool to record the sanitized Plan name only after the Plan path is confirmed to be a file, preventing
invalid declarations from polluting the footer. A later Triage Report replaces the old Routing Intent/Complexity and
clears any stale Plan name; `/new` naturally receives a new `HostedSession` and empty context, while resumed sessions
recover the latest persisted marker.

Extract pure footer-label helpers from `chat-session.js` so visibility, labels, styling segments, and width behavior can
be tested without launching a full TUI. Preserve the current right-pinned layout: truncate the Plan-name suffix first on
narrow terminals, then omit Complexity before Routing Intent if necessary rather than allowing line 1 to overflow or
pushing the label into the middle. The active Agent and Routing Intent are the highest-priority right-side information;
if even those cannot fit, truncate the composed label to the render width.

Use six explicit foreground theme tokens: `routingQuickFix`, `routingFeature`, and `routingEpic` for Routing Intent;
`complexityLow`, `complexityMedium`, and `complexityHigh` for Complexity. The embedded Catppuccin defaults should be six
visually distinct palette values (`teal`, `blue`, `mauve`, `green`, `yellow`, and `red`, respectively). Because partial
external themes are merged over the embedded theme, existing themes inherit safe defaults while themes that define the
new tokens can customize them; switching themes continues to recolor the footer on the next render through the existing
`theme` proxy.

## Files to Modify

- `src/shared/session/workflow-context-session.js` — add the normalized workflow-context shape plus append-only session
  marker read/write helpers for Triage and Plan-name updates.
- `src/shared/session/hosted-session.js` — hydrate Session workflow context and expose guarded getters/setters without
  introducing process-global footer state.
- `src/shared/session/session.js` — pass the active `HostedSession` into the auto-wired Triage-Report Tool, matching the
  existing Plan-Written Tool wiring.
- `src/tools/triage-report.js` — save normalized Routing Intent/Complexity to the active Session when Triage succeeds.
- `src/tools/plan-written.js` — save the sanitized canonical `planName` (without the `plans/` prefix or `.md` suffix)
  after the referenced file passes validation and before the Review Loop begins.
- `src/ui/tui/chat-session.js` — format and render the Agent/workflow/Plan segments on footer line 1, with ANSI-aware
  width budgeting and role/Routing Intent visibility rules.
- `src/ui/theme/catppuccin-mocha.json` — define embedded fallback foreground tokens for Routing Intents and Complexity
  levels so all merged themes have valid values.
- `src/shared/session/workflow-context-session.test.js` — cover marker normalization, latest-value reads, duplicate
  suppression, Plan-name merge, Triage replacement, and malformed persisted data.
- `src/shared/session/hosted-session.test.js` — cover hydration, defensive workflow-context reads, Session isolation,
  and disposal/reset behavior alongside existing Hosted Session state tests.
- `src/tools/__tests__/triage-report.test.js` — verify successful Triage updates Session context and remains safe
  without a HostedSession.
- `src/tools/__tests__/plan-written.test.js` — verify only valid Plan declarations set/replace the Session Plan name.
- `src/ui/theme/theme-json.test.js` — verify partial themes inherit the six embedded workflow tokens and explicit
  overrides remain supported.
- `src/ui/tui/chat-session.test.js` — cover displayed labels, excluded Agents/intents, PROJECT-to-Epic wording,
  ANSI-aware widths, long Plan names, and theme-token selection.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/active-agent-session.js` — follow its append-only custom-entry persistence, tolerant reads, and
  duplicate-marker suppression rather than inventing a second persistence mechanism.
- `src/shared/session/hosted-session.js` — keep footer state scoped to one Hosted Session, consistent with Agent/model,
  thinking-level, and execution-workflow state.
- `src/tools/triage-report.js` — reuse `normalizeTriageParams()` output as the canonical Routing Intent/Complexity
  source.
- `src/tools/plan-written.js` — reuse the existing `.md` stripping and Plan-file validation before recording the name.
- `src/ui/tui/chat-session.js` — reuse `visibleWidth()`, `truncateToWidth()`, the current right-pinned footer
  calculations, and live `theme.fg()` lookups.
- `src/ui/theme/theme-json.js` — rely on existing embedded-theme fallback merging and dynamic foreground-token support;
  no new theme loader or hard-coded ANSI colors are needed.

## Implementation Steps

- [ ] Step 1: Add `workflow-context-session.js` with JSDoc typedefs and strict normalization for all canonical Routing
      Intents, Complexity (`LOW`, `MEDIUM`, `HIGH`), and optional sanitized Plan name; permit a Plan-only context when
      no Triage Report exists. Persist the latest context under a RunWield custom session-entry type and tolerate
      missing/legacy/malformed entries.
- [ ] Step 2: Extend `HostedSession` to initialize workflow context from its root Session Manager, return defensive
      copies, replace context on Triage (clearing stale Plan name), and set a Plan name while retaining current Triage.
- [ ] Step 3: Pass `targetHostedSession` into `createTriageReportTool()` and update the Triage-Report Tool to record its
      normalized Routing Intent/Complexity before emitting its visible Triage status. Keep headless/test calls without a
      HostedSession backward compatible.
- [ ] Step 4: Update the Plan-Written Tool to set the Session Plan name after non-empty/path/file validation succeeds;
      preserve the prior footer value when a call is empty or references a missing/non-file Plan.
- [ ] Step 5: Add pure helpers in `chat-session.js` that map eligible canonical values to `Quick Fix`, `Feature`, and
      `Epic`, map every eligible Complexity to title case, support a standalone Plan-name suffix, enforce the Agent
      exclusions, and return separately styled footer segments.
- [ ] Step 6: Integrate the helpers into footer line 1 while retaining the current cwd/branch left side and right-edge
      pinning. Budget visible width without counting ANSI escapes; truncate/omit the Plan name first, omit Complexity
      next, preserve Agent + Routing Intent whenever possible, and cap the final composed label to avoid narrow-width
      overflow.
- [ ] Step 7: Add the six embedded foreground tokens using the confirmed Catppuccin mappings (`routingQuickFix: teal`,
      `routingFeature: blue`, `routingEpic: mauve`, `complexityLow: green`, `complexityMedium: yellow`,
      `complexityHigh: red`). Reference token names at render time so `/theme` live preview and persisted theme switches
      recolor the footer without rebuilding Session state.
- [ ] Step 8: Add focused persistence/tool/footer tests, including resume hydration, a second Triage clearing an old
      Plan name, excluded Agent Display Names, unsupported Routing Intents, PROJECT displayed as Epic, invalid
      `plan_written`, long names, and partial-theme fallback behavior where appropriate.
- [ ] Step 9: Run focused tests during development, then run `deno task ci` and fix every failure.

## Verification Plan

- Automated focused loop:
  - `deno test -A src/shared/session/workflow-context-session.test.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/plan-written.test.js src/ui/tui/chat-session.test.js`
  - Run the existing theme tests if token/fallback assertions are added: `deno test -A src/ui/theme/theme-json.test.js`.
- Automated full gate: `deno task ci`.
- Manual TUI verification:
  - Start a fresh session with the normal CLI command (`deno task cli`), submit one request for each relevant Routing
    Intent, and confirm footer line 1 shows `Engineer - <Complexity> Quick Fix`, `<Agent> - <Complexity> Feature`, or
    `<Agent> - <Complexity> Epic` as applicable.
  - In a FEATURE flow, confirm Planner initially shows the Triage label without a Plan suffix; after a valid
    `plan_written` call, confirm the sanitized Plan name appears and remains when the active Agent changes to Engineer.
  - Invoke `plan_written` from a direct/load-Plan planning flow with no current Triage marker and confirm the footer
    shows `<Agent> - <plan-name>` without inventing a Routing Intent or Complexity.
  - Trigger invalid/empty Plan declarations and confirm they do not replace the last valid Plan name.
  - Switch to Ideator, Operator, and Guide and confirm only the active Agent Display Name is shown; switch back to a
    workflow Agent and confirm the Session context remains available.
  - Use `/theme` to preview at least two themes and confirm Routing Intent/Complexity colors update live without
    changing the label text.
  - Resize the terminal across wide and narrow widths and test a long Plan name; confirm line 1 stays within the
    terminal, cwd/branch truncation remains stable, and the right block remains pinned.
  - Resume the Session and confirm the latest workflow context and Plan name are restored; use `/new` and confirm stale
    context is absent.
- Expected result: footer context reflects the latest valid Triage/Plan declaration for the current Session, stays
  correctly scoped across Agent changes/resume, hides for excluded Agents, responds to theme changes, and never breaks
  the existing two-line footer layout.
- Headed browser verification is not applicable: this feature changes the terminal TUI only and has no browser route,
  dev server, DOM, or accessibility tree.

## Edge Cases & Considerations

- **Confirmed Complexity policy:** show Complexity for QUICK_FIX, FEATURE, and Epic labels. LOW, MEDIUM, and HIGH each
  receive a distinct theme token/color; the three Routing Intent labels also each receive a distinct theme token/color.
- **Canonical language:** internal state and tests should use Routing Intent, Complexity, Plan, Agent Display Name, and
  Epic. “Classification” is only user-facing shorthand here; do not misuse Plan Classification for QUICK_FIX.
- **New Triage in one Session:** every canonical Routing Intent replaces prior Routing Intent/Complexity and clears the
  old Plan suffix. Unsupported footer intents remain persisted only to prevent stale eligible context from resurfacing;
  they do not receive a colored label.
- **Plan declaration timing and display:** record only after local file validation succeeds, but before opening
  Plannotator. Display the canonical `planName` argument without `plans/` or `.md`, while retaining valid nested names
  such as `epic/child-plan`; Feedback, save, cancel, or approval does not erase the declared Plan name.
- **External themes:** partial themes inherit the embedded token defaults. Custom themes may override the new token
  names; missing tokens must never throw during render.
- **Role matching:** use canonical/internal Agent identity where available rather than fragile localized Display Name
  comparisons; if the footer only has Display Name, centralize the exclusion mapping and test custom Agent definitions.
- **Terminal width:** ANSI escape sequences do not count toward visible width. Truncation priority is Plan name, then
  Complexity, then the final composed Agent/Routing Intent label; the implementation must still return a line no wider
  than the render width.
- **Persistence compatibility:** unknown or malformed custom entries are ignored, older sessions without a marker render
  the current Agent-only footer, and persistence failures remain fail-open so they cannot block Triage or Plan review.
