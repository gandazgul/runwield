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
`src/shared/session/session-transcript-projection.js`. Slice 6 also built two non-mutating locator readers —
`readCatalogSafeRootSessionLocator()` and `listCatalogSafeRootSessionLocators()` in `root-session.js` — that already
avoid `SessionManager.open()` by design. This slice composes all four. It writes no new parser and no new locator
reader.

Two distinct defects live under the `read_only` label, and they need different fixes:

- **A writable Pi call.** `inspectResumableSession` (`session-runtime.js:1690`) calls `openPersistedRootSession()`,
  which calls `SessionManager.open()`. `listResumableSessions` calls `SessionManager.list()`. Both can migrate a
  transcript.
- **A silently empty answer.** `getSessionInfo`, `getLastAssistantText`, `getSessionContextReport`,
  `getSessionMemoryBackupDir`, `exportSession`, and `replaySession` all read through `getRootSessionManager()`. For a
  dormant managed Session that manager is absent, so they return zeros, empty lists, or throw. A Session with real
  history reports "0 messages" and success. That is not a mutation, but it is the same authority failure: a projection
  presenting itself as truth.

There is a related ordering defect, and it is concrete. `loadSession` (`session-runtime.js:2721`) gates its managed
branch on `this.#shouldUseManagedActivation(options) && options.sessionPath`. The caller supplies `sessionPath`. Omit
it, or pass a stale one, and control falls through to `openPersistedRootSession()` at line 2749 — a writable open on a
managed transcript, with no lease. `createInteractiveSession` (`session-runtime.js:2588`) has the same shape: in
`continue` mode it calls Pi's list API to pick the newest transcript _before_ any managed resolution happens.

Managed versus unmanaged status must be resolved before any Pi access. A Session under a current or historical
registered Project root — including a nested working directory, an uncataloged transcript, or a load request with an
omitted or stale `sessionPath` — must catalog or return a typed blocked result. It must never fall through to the
unmanaged open path.

This is part 2 of the former slice 7. It converts no mutation family and touches no adapter.

## Recorded Assumptions

These two decisions were put to the user and the interview timed out with no answer. Both defaults below are the
non-regressing choice. Correct either during Plan review if the intent differs.

- **Managed reads prefer real data over a typed unsupported result.** Where the committed prefix can answer — message
  counts, token totals, last assistant text, export content, replay entries — serve it. Reserve the typed unsupported
  result for what the transcript genuinely cannot supply, such as live context-window occupancy. This slice touches no
  adapter, so a uniform unsupported result would regress every managed Session's TUI display until slice 7 lands. Real
  committed-prefix data is strictly better than today's zeros and needs no adapter change.
- **`replaySession` stays in scope.** Slice 7a classified it `projection_adapter_local`, not `read_only`. It is included
  here anyway because it has the identical silently-empty defect and the identical fix. Deferring it means a re-opened
  managed Session renders an empty scrollback. This Plan therefore covers all 21 `read_only` policy entries plus
  `replaySession`; the remaining `projection_adapter_local` methods stay with slices 7c and 7.

## Objective

- each of the 21 methods the slice 7a policy map classifies `read_only`, plus `replaySession`, returns data derived from
  the committed transcript prefix or a typed unsupported result, and calls no Pi writable open, list, continue, or
  migration API for a managed Session;
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

Add a single guarded locator classifier, `classifyRootSessionLocator()` in `root-session.js`, that every managed entry
point consults before touching Pi. It returns exactly one of three outcomes: `unmanaged_proven`, `managed` with a
resolved locator, or `blocked` with a typed reason. There is no fourth "unknown, proceed anyway" outcome — that is the
fall-through this slice removes. `unmanaged_proven` requires positive owner-coordination evidence that the Project has
never been managed; absence of a record is `blocked`, not `unmanaged_proven`.

Prove the property mechanically rather than by inspection. Add a test helper that instruments the Pi Session Manager
create, open, list, continue, and migration entry points plus transcript byte length, digest, and mtime, then drive
every `read_only` method against a dormant managed Session and assert zero writable calls and zero filesystem change.
That helper is the real deliverable: it is what stops the property from regressing in slices 7c and 7.

The sweep must enumerate `SESSION_RUNTIME_METHOD_POLICY` at run time and fail when any `read_only` entry is not
exercised. A hard-coded method list would silently skip whatever slice 7c adds.

## Files to Modify

- `src/shared/session/session-runtime.js` — reimplement `listResumableSessions` (line 1675), `inspectResumableSession`
  (1688), `getLastAssistantText` (1578), `getSessionInfo` (1597), `getSessionContextReport` (1647),
  `getSessionMemoryBackupDir` (1666), `exportSession` (1739), and `replaySession` (1275) over the committed prefix for
  managed Sessions. Route the `loadSession` managed gate (2721) and the `createInteractiveSession` continue-mode list
  call (2588) through the classifier.
- `src/shared/session/session-transcript-projection.js` — add the reader entry points these methods need (token and
  model inspection, last assistant text, export shape) built on the existing exact-prefix parser.
- `src/shared/session/root-session.js` — add `classifyRootSessionLocator()` and route `openPersistedRootSession`,
  `listPersistedRootSessions`, and `createRootSessionManager` behind it.
- `src/shared/owner-coordination/sessions.js` — supply the historical-root and uncataloged-transcript lookups the
  classifier needs, composing the existing `findSessionByLocator` and `listProjectSessions`.
- `src/shared/session/session-runtime-method-policy.ts` — no new policies; correct any entry slice 7a classified
  optimistically once the real implementation lands.
- `src/shared/session/managed-read-non-mutation.test.ts` — new. The policy-map sweep and its negative control.
- `src/shared/session/root-session-locator-classifier.test.ts` — new. The thirteen-case classifier matrix.
- `src/shared/session/architecture-boundary.test.js` — existing assertions on `SessionManager.open` and
  `openPersistedRootSession` (lines 131, 163, 194, 208, 426) must stay green. Update them for the new routing rather
  than relaxing them.

## Reuse Opportunities

- `src/shared/session/session-transcript-projection.js` — `projectCommittedTranscript()`, `summarizeProjectedEntries()`,
  `getCommittedTranscriptAuthorityFacts()`, and `createReplayEvents()`. The exact-prefix parser already exists and is
  already verified by slice 6. Extend it; do not write a second parser.
- `src/shared/session/root-session.js` — `readCatalogSafeRootSessionLocator()` (line 247) and
  `listCatalogSafeRootSessionLocators()` (line 314) already read transcript headers without `SessionManager.open()`.
  `listResumableSessions` for a managed Project is served by the latter, not by a new reader and not by
  `SessionManager.list()`.
- `src/shared/owner-coordination/sessions.js` — `findSessionByLocator()` (line 253) and `listProjectSessions()` (line
  365) already answer locator questions. The classifier composes these existing lookups.
- `src/shared/session/session-runtime-method-policy.ts` from slice 7a — the policy map is the worklist for this slice.
- `src/shared/git-test-fixture.ts` `defineGitFixture` and `makeValidationProjectRoot` — real repositories and real Plan
  projects for the classifier tests.

## Implementation Steps

- [ ] `src/shared/session/managed-read-non-mutation.test.ts` exports a reusable helper that instruments the Pi Session
      Manager create, open, list, continue, and migration entry points and records every call, and separately records
      transcript byte length, digest, and mtime before and after a call.
- [ ] That test file drives every `read_only` entry it reads from `SESSION_RUNTIME_METHOD_POLICY` at run time, plus
      `replaySession`, against a dormant managed Session, and asserts zero recorded writable calls and zero
      byte/digest/mtime change. The test fails when any `read_only` entry in the map went unexercised, so a later slice
      adding an entry cannot silently skip it.
- [ ] The same file contains a negative control that calls a writable Pi API through the helper and asserts the helper
      reports it. The sweep's passing is therefore evidence of detection, not of a helper that records nothing.
- [ ] `inspectResumableSession` consults `classifyRootSessionLocator()` before any Pi access, contains no call to
      `openPersistedRootSession`, and derives estimated tokens, message count, and model from the committed-prefix
      reader. `listResumableSessions` likewise consults the classifier, serves a managed Project from
      `listCatalogSafeRootSessionLocators()`, and reaches `SessionManager.list()` only on an `unmanaged_proven` verdict.
- [ ] `getSessionInfo`, `getSessionContextReport`, `getLastAssistantText`, `getSessionMemoryBackupDir`, `exportSession`,
      and `replaySession` each return committed-prefix data for a dormant managed Session where the transcript can
      supply it, and a typed unsupported result only where it cannot. A test asserts each returns non-empty data for a
      dormant managed Session with recorded history — today each returns zero, empty, or throws.
- [ ] `root-session.js` exports `classifyRootSessionLocator()`, which returns exactly one of `unmanaged_proven`,
      `managed` with a resolved locator, or `blocked` with a typed reason. It has no fall-through branch and no default
      return. `unmanaged_proven` requires positive owner-coordination evidence; a missing record yields `blocked`.
- [ ] `openPersistedRootSession`, `listPersistedRootSessions`, and `createRootSessionManager` are reachable from
      `loadSession` and `createInteractiveSession` only through an `unmanaged_proven` verdict. The
      `this.#shouldUseManagedActivation(options) && options.sessionPath` gate at `session-runtime.js:2721` no longer
      exists in any form: managed status is resolved without a caller-supplied `sessionPath`.
- [ ] `src/shared/session/root-session-locator-classifier.test.ts` covers a current registered root, a historical
      registered root, a nested working directory under a registered root, an uncataloged transcript, an omitted
      `sessionPath`, a stale `sessionPath`, a locator conflict, a moved Project, a disabled Project, a missing
      activation row, a protocol marker mismatch, and a replaced database epoch. Each returns `blocked` with a typed
      reason, never `unmanaged_proven`.
- [ ] The same file proves a positively unregistered Project returns `unmanaged_proven` and still reaches the legacy
      Session Manager open, create, and list behavior.
- [ ] Truncated, malformed, transcript-ahead, and database-ahead transcripts each produce a typed rejection from the
      read paths rather than a partial or empty success.
- [ ] No blocked result, typed rejection, or log line contains a transcript path, activation proof, fence, or operation
      ID. A test asserts this over the reason payloads.
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
- Behavior expected to stop existing: managed inspection reaching Pi's writable open, list, or continue APIs; the
  unmanaged fall-through for a Session whose managed status could not be resolved; and the caller-supplied `sessionPath`
  as a precondition for recognizing a managed Session. Tests asserting any of these must be rewritten to assert the
  typed result, not deleted. `session-runtime.test.js` lines 875-990 assert `openPersistedRootSession` call ordering
  inside the managed operation paths — those cover slice 7a's mutation fencing, which this slice does not change, so
  they must still pass unmodified.
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
