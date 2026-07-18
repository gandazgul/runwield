---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a TUI-only /context command that reports active Agent Session context-window usage, estimated resident categories, loaded instruction files, and advertised Skills."
affectedPaths:
    - "src/shared/session/session-context-report.js"
    - "src/shared/session/session-context-report.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/cmd/context/index.js"
    - "src/cmd/context/index.test.js"
    - "src/cmd/registry.js"
    - "src/cmd/__tests__/registry.test.js"
    - "docs/usage.md"
frontend: false
createdAt: "2026-07-17T22:54:51-04:00"
updatedAt: "2026-07-18T14:13:58.734Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-18T14:13:58.734Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
---

# Context Window Usage Command

## Context

RunWield exposes cumulative token and compaction details through `/session`, but it does not provide a focused view of
what currently occupies the active Agent Session's context window. The requested `/context` command should provide the
RunWield equivalent of Claude Code's context-usage view while following RunWield's TUI presentation and live-session
architecture.

The current prompt assembly path injects the merged Agent Definition, Tool descriptions, global/project instruction
files, Project State, Core Memories, and the advertised Skill catalog into one flattened system prompt. Pi provides a
last-known context total and context-window size, but not provider-tokenizer attribution by source. RunWield therefore
needs to retain a semantic projection of its own resident context at assembly time and clearly label category counts as
estimates.

## Objective

Add a TUI-only `/context` slash command that renders the active Agent and model, a compact themed usage bar, used/free
context-window totals, estimated usage by resident category, loaded instruction-file details, and advertised Skill
details. Keep all root Agent Session access behind `SessionRuntime`, preserve unknown usage after compaction, and do not
count dormant Prompt Templates or unread Skill bodies as resident context.

## Approach

Capture a context projection from the exact values used during system-prompt assembly instead of re-reading mutable
files when `/context` runs. Store that projection with the active root Agent Session metadata so Agent/model switches,
`/reload`, and `/new` replace it atomically with the rebuilt session.

Add a small context-report module behind a single report-building interface. It should estimate text with the same
chars-per-token convention used by Pi, combine the projection with an aggregate estimate of active conversation
messages, and reconcile the remaining last-known provider total into `Conversation & provider overhead`. The report must
distinguish last-known provider usage, locally estimated initial usage, and Pi's explicit post-compaction unknown state
rather than presenting estimates as exact tokenizer counts.

Expose the semantic report through a public `SessionRuntime.getSessionContextReport(sessionId)` method. The command
should only render that report through `uiAPI.appendSystemMessage`; it must not import `HostedSession`, root metadata,
Pi normalizers, or other live-session internals.

Use an existing themed `SystemMessageBlock` via `appendSystemMessage`, with a short fixed-width filled/empty bar that
wraps safely in narrow terminals. Follow the screenshot's information hierarchy without adding a dedicated TUI block:
headline usage first, category summary second, then instruction files and Skills grouped by source.

## Files to Modify

- `src/shared/session/session-context-report.js` — define JSDoc report/projection shapes and the pure estimation,
  reconciliation, percentage, free-space, and unknown-state logic.
- `src/shared/session/session-context-report.test.js` — cover initial local estimation, provider reconciliation,
  over-window clamping, absent model/window data, and post-compaction unknown usage.
- `src/shared/session/session.js` — retain exact prompt components and item metadata during assembly; include effective
  Tool descriptions/schemas; store/retrieve the projection through root Agent Session metadata and calculate the current
  aggregate active-message estimate on report reads while preserving the existing string-returning prompt assembly
  interface.
- `src/shared/session/session-prompt.test.js` — verify projection categories use the same injected instruction files,
  Core Memories, Skill advertisement lines, Project State, and Agent/system prompt values as the assembled prompt, and
  that hidden Skills are excluded.
- `src/shared/session/session-runtime.js` — add the public context-report projection for an opaque session ID and keep
  root/host details private.
- `src/shared/session/session-runtime.test.js` — verify missing-session/active-Agent behavior, semantic report shape,
  and projection replacement across active Agent rebuilds without exposing internal objects or message contents.
- `src/cmd/context/index.js` — implement themed report formatting, compact usage bar, source-grouped details, and clear
  unavailable/unknown messages.
- `src/cmd/context/index.test.js` — test fresh-session estimates, populated reports, empty sections, unknown usage,
  missing active Agent Session, model/window unavailability, and ANSI-safe rendered content.
- `src/cmd/registry.js` — add `context` to `COMMAND_NAMES`, import/register the handler, and expose it only on the slash
  surface with `/context` help metadata.
- `src/cmd/__tests__/registry.test.js` — assert `/context` is slash-only and resolves as a built-in name that blocks
  Prompt Template collisions.
- `docs/usage.md` — add `/context` to the slash-command reference and distinguish current context-window usage from the
  broader historical `/session` report.

## Reuse Opportunities

- `src/shared/session/session.js` — reuse `assembleFinalSystemPrompt`, `listSkills`, loaded instruction-file precedence,
  root Agent Session metadata, and Pi's existing `estimateTokens` behavior for active messages.
- `src/shared/session/session-runtime.js` — follow `getSessionInfo()` and the existing opaque-ID projection methods
  rather than creating a command-side session access path.
- `src/cmd/session/index.js` — reuse active-session error handling and model/context number-formatting conventions while
  keeping `/context` focused on resident context rather than cumulative billing history.
- `src/ui/tui/api.js` and `src/ui/tui/blocks.js` — reuse `appendSystemMessage`, `SystemMessageBlock` wrapping, and
  current RunWield theme colors; no new TUI interface is needed.
- `src/ui/tui/chat-session.js` — match the existing compact token-count formatting and warning/error thresholds where
  practical without importing consumer-side Runtime normalization.

## Implementation Steps

- [ ] Step 1: Introduce JSDoc typedefs for the context projection/report and implement pure token estimation and report
      reconciliation in `src/shared/session/session-context-report.js`. Categories must be Agent instructions, Tools,
      instruction files, Core Memories, Skill catalog, Project State, and Conversation & provider overhead; free space
      is a separate derived value.
- [ ] Step 2: Refactor prompt assembly in `src/shared/session/session.js` so one read/build pass produces both the final
      prompt and its source projection. Preserve the existing `assembleFinalSystemPrompt()` string result for current
      callers, and ensure the projection records exact injected text plus `{path/name, source, estimatedTokens}` detail
      without retaining duplicate full Skill bodies.
- [ ] Step 3: Extend root Agent Session metadata to retain the static projection, replacing it only when the replacement
      root Agent Session is ready to match existing atomic Agent/model switch and `/reload` behavior. Add an internal
      getter that estimates the current active messages at report time so conversation growth and compaction are never
      read from stale assembly-time data; do not expose raw messages or prompt text through the Runtime report.
- [ ] Step 4: Add `SessionRuntime.getSessionContextReport(sessionId)` to combine active Agent/model identity, Pi's
      `getContextUsage()` state, and the stored projection through the report module. Return `null` for a missing
      session or unavailable active Agent Session and preserve `{tokens: null, percent: null}` after compaction.
- [ ] Step 5: Implement `runContextCommand` and pure formatting helpers. Render a `Context Usage` heading, active Agent
      and provider/model, compact filled/empty usage bar, concise used/window/free summary, estimated category rows with
      percentages when available, loaded instruction files with home paths abbreviated to `~`, and advertised Skills
      grouped as local/home/bundled/external.
- [ ] Step 6: Register `/context` as a slash-only built-in. Keep `/session` behavior unchanged and do not add a CLI
      surface or command arguments in this feature.
- [ ] Step 7: Add unit and integration coverage for assembly attribution, report arithmetic/lifecycle states, command
      formatting, and registry discovery. Tests must verify Prompt Templates and `disableModelInvocation` Skills are not
      counted, while an invoked Skill body is naturally included later through conversation usage rather than the
      resident Skill catalog.
- [ ] Step 8: Update `docs/usage.md`, run the full quality gate, and manually exercise the command across fresh,
      populated, reloaded/switched, compacted, and narrow-terminal sessions.

## Verification Plan

- Automated: run focused tests while iterating with
  `deno test -A src/shared/session/session-context-report.test.js src/shared/session/session-prompt.test.js src/shared/session/session-runtime.test.js src/cmd/context/index.test.js src/cmd/__tests__/registry.test.js`.
- Automated: run the required full repository gate with `deno task ci` and fix all failures.
- Manual: start a fresh TUI and run `/context` before the first model response; verify it shows the active Agent/model,
  a visibly estimated static total, a usage bar, current instruction files, Core Memory/Skill categories, and free
  space.
- Manual: send several prompts and Tool calls, then run `/context`; verify Conversation & provider overhead grows and
  category/free-space values reconcile with the displayed used total.
- Manual: switch Agent and model, edit an instruction file or Skill advertisement, run `/reload`, then run `/context`;
  verify the report reflects the newly active Agent Session projection and not stale on-disk or previous-Agent data.
- Manual: run `/compact` and invoke `/context` before another assistant response; verify total, percentages, and free
  space are shown as unknown while known static category estimates/details remain visible. After the next response,
  verify normal last-known usage returns.
- Manual: test with no instruction files/Core Memories/advertised Skills and with a narrow terminal; verify empty
  sections are concise, the compact bar remains legible, and the existing SystemMessageBlock wraps without corruption.

## Edge Cases & Considerations

- Token attribution is estimated. Provider tokenization, protocol framing, built-in date/environment additions, and
  Tool-schema encoding are not fully attributable; place unexplained positive remainder in Conversation & provider
  overhead and use estimate/last-known labels rather than false precision.
- Before any valid provider usage, derive the headline from known static plus active-message estimates. If known
  estimates exceed stale provider usage after a rebuild, use the reconciled estimated total so categories never exceed
  the displayed total.
- After compaction, honor Pi's unknown context state until a valid post-compaction assistant response; do not invent a
  free-space figure or percentage from partial estimates.
- Clamp free space at zero and the bar at full when reported/estimated usage exceeds the model context window, while
  retaining the over-window numeric total for diagnosis.
- If the active model has no valid context-window size, show estimated category token counts but mark percentage and
  free space unavailable.
- Count only model-advertised Skills in the resident Skill catalog. Exclude Skills with `disableModelInvocation`,
  dormant Prompt Templates, and unread full `SKILL.md` bodies. Once invoked, Skill body text is conversation context.
- Use canonical RunWield language in output and docs: Agent Session, Agent Definition, Tool, Core Memory, Mnemosyne,
  Skill, Project State, and Prompt Template.
- Keep local file paths and detailed categories in the local TUI only; the Runtime report must not expose raw Core
  Memory text, instruction contents, system prompts, Tool schemas, or conversation messages.
- No persistence or migration is required. `/context` is a read-only diagnostic and must not change compaction,
  cumulative `/session` statistics, Agent selection, or session history.
