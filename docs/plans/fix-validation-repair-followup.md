---
planId: "b8850b02-7ef6-4d15-a7f7-dfe876ecd519"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/root-session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/file-session-store.ts"
    - "src/shared/session/session.js"
    - "src/shared/workflow/validation-tool-continuation.integration.test.ts"
    - "src/shared/session/root-session.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "docs/prd/runwield-core-prd.md"
    - "docs/settings.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-11"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
---

# Fix Validation Repair Follow-up

## Context

The user tried to reply after Validation Repair Engineer reported unresolved blockers. The terminal showed automatic
compaction, then `Persisted session path is outside the RunWield session directory for cwd`. Sending the reply failed
and restored the draft. The user also specified that model and thinking settings must fall back to Engineer's configured
values, then to defaults.

Current source evidence:

- `root-session.js` throws this error in both `resolvePersistedRootSession` and `readCatalogSafeRootSessionLocator`.
- `SessionRuntime.#runManagedOperation` reopens the committed Session Transcript Segment before a user turn. It passes
  the segment's `transcriptCwd`, `piSessionId`, and `transcriptPath` to `openPersistedRootSession`.
- Semantic repair creates a successor segment, then activates Validation Repair Engineer in the execution worktree. A
  plain-text blocker without `task_completed` leaves repair paused.
- The file store can catalog a transcript in the Project's Session directory while retaining a different header cwd.
  Reopening currently derives the storage directory from that cwd. This is a concrete mismatch candidate, not a
  reproduced cause. Normal rollover creates matching cwd/path pairs. Compaction alone is not proven to move a file.
- `resolveModel` already falls back to Engineer configuration. `resolveExecutionThinkingLevel` skips it.

The screenshot contains a compiled stack, not the incident's saved path/header values. Reproduction is required before
claiming the crash is fixed.

## Objective

A user can reply to a paused Validation Repair Engineer, including after compaction, without losing the Session, repair
context, or execution worktree. Valid saved transcripts reopen without the reported directory error.

For Validation Repair Engineer (`reviewer-feedback-engineer`), each missing model/thinking setting uses Engineer's
configured value, then the existing default chain. Explicit overrides and repair-specific settings still win.

## Approach

Keep the existing Session and validation design in ADR-015. Trace and test this path:

```text
semantic repair in execution worktree
  → blocker response without task_completed
  → compaction and operation settlement
  → TUI submit → promptUserTurn
  → writer lock → reopen committed segment
  → same repair Agent receives reply
```

First reproduce the directory error through the real runtime and file store. Compare the Project root, execution cwd,
transcript header cwd, committed segment locator, and expected storage directory at the failing call. Use the result to
correct the path/cwd handoff at its owner.

Where storage and execution roots legitimately differ, resolve the transcript location from the file store's Project and
committed segment evidence, separately from the Agent's working directory. Reuse catalog-safe validation. Do not infer
permission to open a file from `dirname(sessionPath)` alone. Keep ordinary root-session path requests guarded. No new
storage format, transcript relocation, or user-run repair command is intended. If the reproduction instead shows an
incorrect locator being written, correct that producer and cover existing recoverable records through the same validated
evidence.

For thinking, add the missing Engineer lookup in `resolveExecutionThinkingLevel` for
`AGENTS.REVIEWER_FEEDBACK_ENGINEER`, before the settings default. Reuse the existing configured-Agent getters so active
presets keep their current precedence. Model and thinking inherit independently; `off` is an explicit value, not
absence. Keep model resolution and other Agents' thinking behavior unchanged.

Removing the path guard would be smaller, but could open an unrelated transcript and would not fix the wrong context. A
new Guided Repair mode is also unnecessary for this bug.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/root-session.js`, `file-session-store.ts`, and `session-runtime.js` — correct validated transcript
  reopening and the cwd/path handoff without changing Session identity or storage authority.
- `src/shared/session/segment-rollover.ts` and `agent-switching.js` — inspect the transition into worktree repair;
  change only if reproduction identifies an incorrect value produced here.
- `src/shared/session/session.js` — add repair thinking inheritance through the shared Pi/CLI session construction path.
- `src/shared/workflow/validation-tool-continuation.integration.test.ts` and focused Session integration tests — prove
  blocked repair, compaction, settlement, and ordinary follow-up compose correctly.
- `src/shared/session/root-session.test.js`, `file-session-store.test.js`, and `segment-rollover.test.js` — protect
  valid storage locations, identity checks, containment, and rollover behavior.
- `src/shared/session/__tests__/session-tools-policy.test.js` — verify actual resolved model and thinking values.
- `docs/prd/runwield-core-prd.md` — add targeted acceptance scenarios under execution/recovery and models/providers.
- `docs/settings.md` — correct resolution-order documentation, including existing Engineer model fallback and the new
  repair thinking fallback.

No browser redesign, new repair mode, validation policy change, or domain-language change is included. The draft
`docs/plans/guided-validation-repair.md` describes separate work and is not a dependency. The Discord work shown inside
the screenshot is not part of this RunWield fix.

## Reuse Opportunities

- `withRuntimeCommandFixture` in `src/cmd/testing/runtime-command-fixture.ts` — scripted model responses with real
  runtime configuration. Fake model/network behavior, not Session persistence or workflow decisions.
- `defineGitFixture` and existing validation worktree fixtures — real distinct Project and execution checkouts.
- `readCatalogSafeRootSessionLocator`, committed manifest evidence, and existing writer-lock operations — validate and
  reopen known transcripts without a second authority.
- `getConfiguredAgentModel` and `getConfiguredAgentThinkingLevel` — existing preset and base-setting precedence.
- Existing restart-follow-up and task-completion tests — preserve completion gating rather than replace it with text
  matching.

## Implementation Steps

1. A deterministic regression exercises a persisted Session, distinct execution worktree, blocked semantic repair,
   compaction, settlement, and a normal follow-up. Before the fix, it fails with the reported path error at the actual
   failing boundary. Record which cwd/path values disagree. A malformed hand-written locator alone is not evidence that
   the user journey is reproduced. If the current tree does not reproduce it, retain the findings and obtain an incident
   trace or a supported older-layout fixture before declaring the crash resolved.
2. The reproduced valid transcript reopens through verified Project/segment evidence. Both compaction settlement and the
   next user turn succeed. The reply reaches Validation Repair Engineer once, with its prior blocker context and the
   existing worktree cwd. The durable Session ID, Plan association, prior transcript, and unresolved workflow remain
   intact. The same saved Session can be loaded and continued after runtime disposal.
3. Invalid outside paths, symlink escapes, wrong transcript identities, and unrelated Project transcripts remain
   rejected before writable opening. The normal writer lock and committed-generation checks remain active. No catch
   suppresses the error by returning success, starting a blank Session, or switching to the primary checkout.
4. Missing repair thinking configuration resolves through Engineer configuration before defaults in both session
   construction paths. Behavioral assertions cover explicit repair settings, Engineer inheritance, defaults, presets,
   independent field inheritance, explicit `off`, and invocation overrides. Existing same-Agent manual model behavior
   and explicit errors for invalid configured models remain unchanged.
5. Core requirements and settings documentation describe the delivered behavior and its acceptance scenarios in the same
   change. They do not claim that all automatic recovery cases are solved by this fix.

## Approval Confirmation

No Work Records are proposed for replacement.

## Verification Plan

### Behavioral proof

- Use real file-backed Sessions, Git worktrees, and workflow state. Script model output so repair returns a blocker
  without `task_completed`; use the actual compaction path with deterministic model responses, not a fabricated success
  event. A no-compaction variant distinguishes compaction from the worktree handoff.
- Submit a unique follow-up through the runtime boundary used by TUI. Assert the provider receives it exactly once, sees
  the prior repair context or its real compaction summary, and runs as Validation Repair Engineer in the same worktree.
  Assert the reply is persisted once and the workflow remains paused when the next response also lacks `task_completed`.
  Dispose/load, submit another reply, and verify continuity without replaying earlier model/tool calls.
- Preserve existing accepted-`task_completed` continuation coverage: valid completion resumes validation; plain text
  does not. Keep existing paused-worktree, restart, sealed-history, generation, and writer-lock tests. No existing
  behavior is intentionally removed.
- Through the changed writable-opening boundary, reject an outside file, symlink escape, wrong Pi Session ID, and a
  valid transcript from an unrelated Project. Retain supported canonical/symlink cwd behavior and worktree successors.
- Use distinct fixture models and thinking levels so fallback order is observable. Check actual session construction,
  not just log text. Repair-specific model with absent thinking must inherit Engineer thinking, and the reverse must
  also work. Explicit repair or Engineer `off` must not fall through. Verify the shared change also reaches CLI
  execution configuration using its existing subprocess fixture, without requiring a live provider.

The runtime follow-up test fails if reopening is stubbed, the error is swallowed, or repair is replaced with an empty
Session. The thinking test with a configured Engineer level different from the default fails on current resolution.

### Commands

Use the sandboxed runner only. Include any new focused test file in this command:

```sh
deno run -A scripts/run-tests.js src/shared/session/root-session.test.js src/shared/session/file-session-store.test.js src/shared/session/segment-rollover.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/workflow/validation-tool-continuation.integration.test.ts
deno task ci
```

Tests that mutate HOME or cwd must use `withProcessGlobalTestLock`. Do not add injection hooks for RunWield-owned
persistence or workflow operations. `deno task seams:check` must pass without a new baseline.

### Manual

In a disposable Project, reach a semantic repair blocker in the TUI, compact, and send a reply asking for a summary of
remaining work. Confirm the reply appears once, the same repair Agent answers, and the worktree remains active. Reload
that Session and send another reply. There must be no path error, restored-draft failure for the valid reply, missing
history, or premature validation/publication. Confirm effective settings with repair settings unset, Engineer settings
set, then both unset.

## Edge Cases & Considerations

- The screenshot establishes the symptom, not the exact cause or installed version. Do not present the directory
  mismatch candidate as proven until the regression reproduces it.
- Existing catalog records may separate storage root from header cwd. Recover valid records using known Session
  evidence; do not rewrite transcript headers or accept arbitrary files to make them fit.
- Compaction must remain enabled and preserve committed history. Disabling it is not a fix.
- A configured but invalid model is not a missing model. Preserve explicit configuration errors rather than silently
  choose a different model.
- Scope follows the user's repair context: add thinking fallback for Validation Repair Engineer, not every Agent. Keep
  current preset lookup, project/global settings merge, manual override lifetime, and provider thinking normalization.
- Preserve pending work and truthful evidence on genuine failures. This bounded repair does not replace the broader
  automatic recovery requirements in the Core PRD.
