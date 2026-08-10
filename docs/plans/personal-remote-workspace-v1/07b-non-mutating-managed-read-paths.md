---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Serve every read-only managed Session inspection, export, and context estimate from the committed transcript prefix, and resolve managed identity before any Pi writable open, list, continue, or migration call."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-method-policy.ts"
    - "src/shared/session/root-session.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/owner-coordination/sessions.js"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-10T18:33:16-04:00"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 7
dependencies:
    - "07a-fenced-session-operation-boundary"
---

# Non-Mutating Managed Read Paths

## Context

Slice 7a classifies every public `SessionRuntime` method and makes the operation capability the unit of authority. That
classification exposes a second problem it deliberately does not fix: several methods classified `read_only` are not
actually non-mutating today.

Pi's `SessionManager.open()`, list, and continue APIs may migrate or rewrite a transcript. A method that looks read-like
at the RunWield layer can therefore change transcript bytes on disk without holding a Session Activation Lease. That
breaks the committed-generation evidence the whole activation design rests on: the next operation compares byte length,
digest, and terminal entry ID against the published generation and fails closed on a mismatch it did not cause.

The affected surface is the inspection and export family — resumable Session listing and inspection, Session info,
context reports, last assistant text, memory backup location, replay, and export. Slice 6 already built the exact-prefix
reader these should use: `projectCommittedTranscript()` and the committed cursor helpers in
`src/shared/session/session-transcript-projection.js`.

There is a related ordering defect. Managed versus unmanaged status must be resolved before any Pi access. A Session
under a current or historical registered Project root — including a nested working directory, an uncataloged transcript,
or a load request with an omitted or stale `sessionPath` — must catalog or return a typed blocked result. It must never
fall through to the unmanaged open path, because that path opens a writable manager.

This is part 2 of the former slice 7. It converts no mutation family and touches no adapter.

## Objective

- every method the slice 7a policy map classifies `read_only` returns data derived from the committed transcript prefix,
  or a typed unsupported result, and calls no Pi writable open, list, continue, or migration API;
- managed inspection, export, listing, projection, and stale refresh leave transcript bytes and mtime unchanged and
  publish no generation;
- malformed, truncated, transcript-ahead, and database-ahead evidence is rejected with a typed result rather than
  silently returning empty or stale data;
- managed identity is resolved from owner coordination before any Pi access, covering current and historical registered
  roots, nested working directories, uncataloged transcripts, omitted or stale `sessionPath`, locator conflicts, moved
  or disabled Projects, missing activation rows, and protocol or epoch mismatch; and
- only positive owner-coordination evidence that a Project has never been managed permits the legacy Session Manager
  open, create, and list behavior.

No read path acquires an activation lease. Reads stay lease-free; they simply stop being writes.

## Approach

Work down the slice 7a policy map, one `read_only` entry at a time. For each, replace the Pi writable call with the
committed-prefix reader and give it a typed unsupported result for the managed-but-unreadable case.

Add a single guarded locator classifier that every managed entry point consults before touching Pi. It returns one of:
unmanaged (positively proven), managed with a resolved locator, or a typed blocked reason. There is no fourth "unknown,
proceed anyway" outcome — that is the fall-through this slice removes.

Prove the property mechanically rather than by inspection. Add a test helper that instruments the Pi Session Manager
create, open, list, continue, and migration entry points plus transcript byte length and mtime, then drive every
`read_only` method against a dormant managed Session and assert zero writable calls and zero filesystem change. That
helper is the real deliverable: it is what stops the property from regressing in slices 7c and 7.

## Files to Modify

- `src/shared/session/session-runtime.js` — reimplement `listResumableSessions`, `inspectResumableSession`,
  `getSessionInfo`, `getSessionContextReport`, `getLastAssistantText`, `getSessionMemoryBackupDir`, `replaySession`, and
  `exportSession` over the committed prefix for managed Sessions; return typed unsupported results where the committed
  prefix cannot answer.
- `src/shared/session/session-transcript-projection.js` — add the reader entry points these methods need (token and
  model inspection, last assistant text, export shape) built on the existing exact-prefix parser.
- `src/shared/session/root-session.js` — add the guarded locator classifier and route `openPersistedRootSession` and the
  legacy open/create/list paths behind it.
- `src/shared/owner-coordination/sessions.js` — supply the historical-root and uncataloged-transcript lookups the
  classifier needs.
- `src/shared/session/session-runtime-method-policy.ts` — no new policies; correct any entry slice 7a classified
  optimistically once the real implementation lands.
- New focused tests beside the modules above, including the writable-API instrumentation helper.

## Reuse Opportunities

- `src/shared/session/session-transcript-projection.js` `projectCommittedTranscript()` and the committed cursor helpers
  — the exact-prefix parser already exists and is already verified by slice 6. Extend it; do not write a second parser.
- `src/shared/owner-coordination/sessions.js` — the Session catalog already answers locator questions. The classifier
  composes existing lookups.
- `src/shared/session/session-runtime-method-policy.ts` from slice 7a — the policy map is the worklist for this slice.
- `src/shared/git-test-fixture.ts` `defineGitFixture` and `makeValidationProjectRoot` — real repositories and real Plan
  projects for the classifier tests.

## Implementation Steps

- [ ] A test helper instruments the Pi Session Manager create, open, list, continue, and migration entry points and
      records every call, and separately records transcript byte length, digest, and mtime before and after a call.
- [ ] Every method the policy map classifies `read_only` runs against a dormant managed Session through that helper with
      zero recorded writable calls and zero byte/digest/mtime change. The helper's own detection is proven by a negative
      control that calls a writable API and fails the assertion.
- [ ] `listResumableSessions` and `inspectResumableSession` return token, model, and message data for managed Sessions
      derived from `projectCommittedTranscript()`. Neither calls `SessionManager.open()`, list, continue, or a migration
      API for a managed Session.
- [ ] `getSessionInfo`, `getSessionContextReport`, `getLastAssistantText`, `getSessionMemoryBackupDir`, `replaySession`,
      and `exportSession` each return committed-prefix data or a typed unsupported result for a managed Session. None
      returns a silently empty or stale success.
- [ ] A guarded locator classifier in `root-session.js` returns exactly one of unmanaged-proven, managed-with-locator,
      or a typed blocked reason, and has no fall-through branch. `openPersistedRootSession` and the legacy open, create,
      and list paths are reachable only through it.
- [ ] Classifier tests cover a current registered root, a historical registered root, a nested working directory under a
      registered root, an uncataloged transcript, an omitted `sessionPath`, a stale `sessionPath`, a locator conflict, a
      moved Project, a disabled Project, a missing activation row, a protocol marker mismatch, and a replaced database
      epoch. Each returns a typed blocked reason, never unmanaged fall-through.
- [ ] A positively unregistered Project still reaches the legacy Session Manager open, create, and list behavior, proven
      by a test that asserts the legacy path is taken.
- [ ] Truncated, malformed, transcript-ahead, and database-ahead transcripts each produce a typed rejection from the
      read paths rather than a partial or empty success.
- [ ] No blocked result, typed rejection, or log line contains a transcript path, activation proof, fence, or operation
      ID.
- [ ] `deno task ci` passes with `language-policy:check` clean and `seams:check` at the unchanged zero baseline.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js -A --no-check src/shared/session src/shared/owner-coordination` during
  development, then full `deno task ci`.
- Automated: the instrumentation helper is the primary gate — it drives every `read_only` policy entry and asserts no
  writable Pi call and no filesystem change.
- Automated: the classifier matrix covers all thirteen listed locator cases.
- Behavior that must still be protected: unmanaged Session inspection, export, replay, and resumable listing keep their
  current results exactly. Slice 6 committed-prefix projection and idle TUI synchronization keep their current event
  stream and stable event IDs.
- Behavior expected to stop existing: managed inspection reaching Pi's writable open, list, or continue APIs; and the
  unmanaged fall-through for a Session whose managed status could not be resolved. Tests asserting either must be
  rewritten to assert the typed result, not deleted.
- Manual: on a managed Session, run `/session` and the context report while another surface holds the Session, and
  confirm the committed generation does not move and the transcript mtime does not change.

## Edge Cases & Considerations

- **Read-only really means non-mutating.** Pi list, open, and continue may migrate or rewrite. A method that looks
  read-like at the RunWield layer is not evidence. Only the instrumentation helper is evidence.
- **Reads take no lease.** This slice must not make inspection acquire activation. A lease-taking read would serialize
  the Workspace and TUI observers against the active writer, which is the behavior slice 6 exists to avoid.
- **Typed unsupported beats a plausible lie.** Where the committed prefix genuinely cannot answer, return the typed
  unsupported result. Do not synthesize a zero, an empty list, or a stale cached value.
- **No proof leakage.** Blocked results reach adapters and, through them, users. They carry a reason code and nothing
  about paths, proofs, fences, or operation identity.
- **New source is TypeScript.** ADR-013 and `language-policy:check` reject a new production `.js` under `src/`. Existing
  `.js` modules stay `.js`; do not convert them opportunistically here.
- **The helper outlives this slice.** Slices 7c and 7 add mutation families and adapters. Write the instrumentation
  helper as a reusable test utility so those slices can assert the same property, not as a one-off inside one test file.
