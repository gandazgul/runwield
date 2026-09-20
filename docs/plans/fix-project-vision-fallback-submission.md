---
planId: "6bbcd530-97b4-471e-bf8b-a6507e808f35"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "src/shared/settings.js"
    - "src/shared/session/image-attachments.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/tools/see-image.ts"
    - "src/ui/tui/chat-input-controller.ts"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/routes/owner-session-api.js"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/shared/session/session-runtime.test.js"
    - "src/ui/workspace/session-continuation.integration.test.ts"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/settings.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev"
devServerHmr: true
createdAt: "2026-09-12T18:33:00-04:00"
status: "validated"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
workRecord:
    status: "generated"
    recordId: "421bead8-a69a-46da-94cb-44d08bf2ecde"
    path: "docs/work-records/2026-09-20-fixed-project-scoped-vision-fallback-and-image-submission.md"
    lastAttemptAt: "2026-09-20T03:13:15.722Z"
---

# Fix Project Vision Fallback and Image Submission

## Context

The [Core gap audit](../reports/core-prd-gap-audit.md#10-optional-vision-configuration-and-project-isolation) identified
two errors: optional fallback validation can block text-only Agent creation, and fallback resolution reads the process
working directory instead of the Session's Project. Later planning found that correcting settings alone does not meet
existing image-send requirements: TUI skips send-time validation for images checked on paste, and Workspace clears
drafts when an asynchronous operation is accepted, before image validation fails.

These are source-confirmed paths, not executed reproductions. The startup error is proven for missing configured auth,
invalid references, or unsuitable fallback models; a provider rejecting expired credentials later is a different
failure.

Owning requirements:

- Core [Compaction and image context](../prd/runwield-core-prd.md#compaction-and-image-context): **Retain useful
  conversation and attachment context**, including fallback precedence, clear setup guidance, retained drafts/previews,
  and changes between paste and Send.
- Core [Models and providers](../prd/runwield-core-prd.md#models-and-providers): **Change models without losing Session
  or workflow context**. Optional image setup must not prevent ordinary text use.
- Workspace [Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions): **Preserve conversation, drafts, and
  controls in the browser**, including failed image sends.

**User decision:** Include the complete TUI and Workspace send flow, not only settings/startup. Preserve existing model,
Agent, preset, authentication, and backend rules. No requirement is removed. The proposed scenario additions make these
existing commitments explicit; this Plan does not claim all other failed-send or long-run context cases are solved.

## Objective

Text-only work remains usable with invalid optional vision setup. Every image submission uses the actual destination
Agent/model and the correct Project's fallback settings. A setup rejection happens before the message is accepted or
committed and preserves exact typed text and previews. Correcting setup permits one successful send, not a duplicate.

## Approach

Keep settings and model selection with their current owners. Factor only the production preparation needed to share the
actual invocation's selected Agent/model between validation and submission. Do not build an Agent or call a model merely
to validate image setup, and do not introduce an injectable model-selection or settings seam.

```text
Project + actual invocation + applicable Agent/model choices
  -> existing model resolution, prepared once for this submission
  -> image validation only when images exist
     invalid -> setup error; no accepted message; keep draft/previews
     valid   -> existing receipt/operation and managed submission
                -> same selected model; persist user message once
```

### Project settings and lazy fallback

`getResolvedVisionFallbackModelSetting` takes an explicit Project root and passes it through every merged settings read.
`resolveVisionFallbackModel` also requires the root. Update startup, prompt, steering, image preflight, and tool
callers; source search is necessary because the reference index missed the `runPrompt` call during planning.

At `buildAgentSession`, read only the configured fallback reference to decide whether to expose `see_image`; defer
fallback discovery, capability checks, and auth validation until images are submitted or that tool executes. Resolve
inside the real `see_image.execute`, not an injected resolver. Preserve image-reference safety and genuine completion/
network boundaries. Direct-vision models bypass optional fallback validation. An unset fallback remains disabled.

Keep current precedence: Project overrides global; active preset fallback overrides top-level fallback; existing preset
merge depth does not change. Existing linked-worktree settings resolution still uses the primary repository. Steering
uses the destination Agent Session's manager cwd, not an invented `session.cwd` property on Pi's Agent Session.

### Validate the same model that will receive the request

Current `preflightSessionImages` reads a root/saved model and cannot fully represent a deferred new Session, an Agent
change, an unavailable saved model, or a Prompt Template override. Reuse `resolveModel` and current invocation
preparation instead of creating a competing approximation in Workspace.

The prepared submission must honor Agent defaults, manual override lifetime, valid saved selections on resume, and
Prompt Template overrides (`modelOverride` with the current ignore-manual rule). Pass that resolved selection into
actual Agent construction/submission. A successful preflight must not be followed by independent selection of a
different model. Current generation/writer checks still decide whether the submission can proceed; preparation is not
write authority.

Runtime uses the same validation before early `USER_MESSAGE` events, transcript insertion, image persistence, and named-
invocation display messages. Keep the final `runPrompt`/steering image checks as defense at the actual destination.
Return specific setup errors through the normal preflight result rather than replacing them with generic provider-login
advice. Do not convert a genuine provider failure after acceptance into a false claim that the request was never sent.

### Workspace acceptance and retention

The current service entry points are `createSession` and `startContinuation`; there is no `startOperation` method.

- **New Session:** validate project/input and check the existing request identity; create the deferred Runtime shell and
  apply explicit launch choices; prepare/validate the invocation before recording acceptance or scheduling its turn. On
  rejection close the unused shell. Recheck matching requests after awaited preparation so concurrent submissions do not
  create duplicate operations. Displayed defaults must not become manual overrides.
- **Continuation:** keep existing receipt lookup and ownership/generation checks first. Adopt the saved Session into a
  Runtime shell and prepare/validate before creating a new receipt or marking an operation running. Close unused shells
  on rejection or a competing identical accepted request. Retain the existing request-hash conflict behavior.
- **Browser:** distinguish image validation rejection from busy/stale-generation conflicts. Use the current error body
  with a specific image-validation status (422) rather than the existing generic 409 path that queues and clears input.
  Preserve text, previews, and error detail; do not autoqueue validation failures or label them network failures. Delay
  optimistic new-Session user messages until acceptance, or remove only that rejected optimistic entry.

Keep the existing owner route and access checks. No public vision endpoint, new persistent submission store, or new
Session lifecycle state is needed.

### TUI and steering

Check all attached images at every Send, after pending paste work finishes. Cache warning display only, never validity.
Restore exact editor text on early rejection and retain previews. Recheck after model/Agent/settings changes.

Steering validates against its actual foreground recipient, not the staged next-turn model. Cover steering queued during
handoff as well as direct steering. A validation failure must not silently become a queued next-turn message. Retain
queued images if eventual dispatch is rejected, and preserve existing request deduplication without caching a rejected
validation as permanent accepted work.

A settings-only patch was set aside by the user because it would still lose drafts after accepted asynchronous failures.
This remains a bounded image-submission correction, not a redesign of all failed-send recovery.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/settings.js`, `session/image-attachments.js`, and tests — explicit root, precedence, and lazy fallback.
- `src/shared/session/session.js`, `session-runtime.js`, and existing model/invocation preparation — one effective model
  selection for preflight and actual submission, plus early rejection before transcript effects.
- `src/tools/see-image.ts` and tests — resolve configured fallback when invoked, retaining safe references and auth.
- `src/ui/tui/chat-input-controller.ts` and tests — always-current send validation, exact draft retention, warning
  dedup.
- `src/ui/workspace/server/session-continuation.js`, `src/ui/workspace/routes/owner-session-api.js`, and integration
  tests — validate before acceptance with correct cleanup, receipts, access checks, and image-specific error mapping.
- `src/ui/workspace/islands/SessionSurface.jsx`, UX tests, and current draft helpers — preserve draft/previews and avoid
  optimistic duplicates or autoqueue on validation rejection. Reuse current controls and `--rw-*` styles.
- `src/shared/session/live-session-connection.ts` and steering callers if needed — preserve recipient selection and
  request dedup when validation rejects steering.
- `docs/settings.md`, Core/Workspace PRDs — deferred fallback validation, correct Project scope, and actual failed-send
  scenarios. Existing domain terms suffice; no glossary redefinition or new architecture decision is proposed.

## Reuse Opportunities

- Existing `resolveModel`, Agent loading, model reconfiguration, and named-invocation preparation — current selection
  rules rather than a parallel browser-only resolver.
- `preflightImageAttachments`, provider discovery/auth, and `see_image` completion paths — retain input and backend
  limits.
- Current operation receipts and live-connection request identities — no new durable dedup store.
- `withRuntimeCommandFixture` and real temporary settings/Session/Git fixtures — use a text-only fixture model; default
  fixture models are vision-capable and would hide the bug.
- Existing Workspace draft storage and error rendering — failed validation is a retained draft, not a new chat item.

## Implementation Steps

- [ ] Regression cases reproduce invalid optional fallback blocking text startup, wrong-Project resolution, and image
      validation that currently occurs after composer clearing. They exercise real settings and submission boundaries.
- [ ] Every production fallback read uses an explicit Project root. Text-only construction and model changes do not
      validate unused fallback; `see_image` and image prompts/steering validate at use with unchanged precedence and
      auth rules.
- [ ] Shared production preparation selects the actual invocation model once for image validation and submission. Agent
      defaults, saved/manual choices, and template overrides stay compatible. A rejected send emits and commits no user
      or named-invocation display message and does not advance managed generation.
- [ ] New/resumed Workspace image requests are validated before acceptance, receipt creation for new work, and
      asynchronous dispatch. Rejection cleans unused shells, returns image-specific errors, and preserves dedup and
      access checks.
- [ ] TUI and browser retain exact text and previews after image setup rejection, including paste followed by a model
      change, new Session, continuation, and steering. They do not autoqueue or add optimistic duplicate messages.
      Corrected sends succeed exactly once; previously queued images remain recoverable if dispatch rejects them.
- [ ] Behavioral tests and headed-browser/TUI checks prove the full path. Core/Workspace capability scenarios and
      settings references describe what actually landed. Attachment rollover, CLI compaction, and image generation
      remain separate.

## Approval Confirmation

No Work Record supersession is proposed. The user explicitly chose complete TUI/Workspace submission coverage rather
than settings-only scope. This is a draft for later approval. Engineer owns this shared-runtime correction; browser
edits are part of that outcome. Autonomous execution is appropriate with the concrete flows below.

## Verification Plan

The key regression must fail if the resolver is merely wrapped, if Workspace validates a different model, or if browser
input is still cleared before setup failure. Run tests only through the sandboxed runner.

**Settings/startup/tool matrix:** Process cwd stays in Project A while two real Sessions use A and B. Give them distinct
fallback settings and active presets. Assert selected model refs, Project/global precedence, disabled fallback, linked-
worktree behavior, and unchanged global settings. Construct a text-only Agent with
invalid/unknown/non-vision/missing-auth fallback: ordinary text succeeds; actual image use fails with the specific setup
action. Direct-vision images bypass the bad optional fallback. `see_image` still checks references, provider
configuration, auth, and cancellation when called.

**Real Runtime submission:** Cover deferred new Session, resume with saved selection, Agent change resetting overrides,
explicit model choice, and Prompt Template model override. Assert the preflight choice equals the actual provider call's
model. Rejected image submission produces zero provider calls, user events, transcript entries, named-invocation display
entries, or generation changes. Include deliberately conflicting selections: a vision-capable root with a text-only
Agent or template destination, and the reverse. Verify the actual provider request, not only a reported preparation
field. A stale-root preflight must fail these tests. After setup correction, the same text/images enter once. Preserve
read-only preparation.

**Workspace service/HTTP:** Exercise new and resumed submissions through real service and owner route. On invalid setup,
no accepted new operation/receipt or turn survives; browser receives a validation error, not busy/network
classification. Concurrent matching request IDs produce one accepted turn; changed content with the same ID is rejected.
Existing accepted receipt replay retains its current semantics. Verify unused Runtime shells are closed without
reserving the saved Session.

**Composer/steering:** Paste on a vision model, change to text-only with unsuitable fallback, then Send. Exact
whitespace, text, and image previews remain. Repeat in browser and TUI; correct setup and send once. Validate against
foreground steering recipients, including handoff/queued steering. A rejected steer is neither accepted nor autoqueued.
Preserve queued content on a later validation rejection. Separate warning dedup from validation freshness.

```sh
deno run -A scripts/run-tests.js src/shared/settings.test.js src/shared/session/image-attachments.test.js src/tools/see-image.test.js src/shared/session/__tests__/session-tools-policy.test.js
deno run -A scripts/run-tests.js src/shared/session/session-prompt.test.js src/shared/session/session-catalog.test.js src/shared/session/session-runtime.test.js src/shared/session/managed-read-non-mutation.test.ts
deno run -A scripts/run-tests.js src/ui/tui/chat-input-controller.test.ts src/ui/workspace/session-continuation.integration.test.ts src/ui/workspace/workspace-session-ux.test.tsx src/ui/workspace/owner-workspace.test.js
deno task seams:check
deno task ci
```

Preserve existing fallback marker/no-raw-byte tests, direct-vision behavior, model precedence, template display
semantics, Session continuation/dedup, and read-only checks. Replace the test that expects invalid unused fallback to
fail startup; that behavior is deliberately removed. Existing paste-only and same-cwd tests are insufficient and must
not be used as proof of the new flows. Use real temporary files and `withProcessGlobalTestLock`; no owned
runtime/persistence seams.

**Manual:** Start `deno task workspace:dev` and open `/dev` in an assignment-specific headed `agent-browser` session.
Use Surface Lab for error layout only; use the real owner Session routes with controlled model responses to prove send
acceptance. At desktop and 390×844, test new/resumed image submission, model change before Send, exact retained draft,
preview retention after refresh, correction and one successful message, and image steering rejection. Inspect requests,
console, and persisted transcript evidence. Run the equivalent paste/model-change/Send journey in TUI; the existing
clipboard integration test is macOS-specific, so record platform limits. No new browser framework is authorized.

## Edge Cases & Considerations

- `generate-image-tool.md` is a separate draft PROJECT touching these files. Preserve its independent scope; do not add
  image generation or new provider registrations here.
- This Plan does not fix image references after transcript rollover or CLI compaction. Do not claim those gaps closed.
- A saved model may no longer be selectable. Use existing fallback selection rules and validate their actual result;
  checking only saved metadata creates a false positive.
- Preflight may perform existing provider discovery, but it is not a committed Session mutation. Recheck generation and
  dedup after awaited work. Do not hold or manufacture writer authority merely to inspect settings.
- Backend-specific attachment restrictions remain valid. Do not route unsupported CLI attachments through a fallback as
  a side effect of this fix.
- Provider/network failures after genuine acceptance remain accepted work with normal failure handling. Do not replay
  them automatically under the label of preflight or overwrite a newer user draft while restoring older content.
- Settings storage, Session architecture, and model precedence are not redesigned. If implementation requires a new
  persistent preparation state or a different ownership rule, stop for a scope decision rather than inventing it.
