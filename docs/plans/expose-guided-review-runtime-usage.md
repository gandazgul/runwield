---
planId: "4046a097-b84d-42f8-9d3c-9c1841dd89fc"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/cli.ts"
    - "src/cmd/guided-review/index.ts"
    - "src/cmd/guided-review/index.test.ts"
    - "src/ui/workspace/routes/api/review-agent-handlers.js"
    - "src/ui/workspace/react/CodeReviewSurface.tsx"
    - "src/ui/workspace/react/guided-review-status.ts"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/workspace-review.test.js"
    - "src/ui/workspace/react/guided-review-status.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev/code-review"
devServerHmr: true
createdAt: "2026-09-01T12:38:58-04:00"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "99d0a618-adb5-461f-b344-1c2980fd08ae"
    path: "docs/work-records/2026-09-01-guided-review-usage-reporting.md"
    lastAttemptAt: "2026-09-01T23:07:44.426Z"
routingIntent: "PLANNED_CHANGE"
targetBranch: "main"
---

# Expose Guided Review Runtime Usage

## Context

During Guided Review generation, the code-review toolbar shows `tokens unavailable` and `cost unavailable`. The toolbar
already accepts token and cost fields, and `SessionRuntime` already emits normalized `usage` events with input, output,
cache-read, cache-write, and USD cost values. The data is lost at the hidden command boundary:

```text
SessionRuntime usage event
  -> wld guided-review discards it
  -> subprocess returns only review JSON
  -> Guided Review job has no usage
  -> toolbar shows unavailable
```

The default provider must remain the hidden `wld guided-review` subprocess. An explicit `RUNWIELD_GUIDED_REVIEW_COMMAND`
remains a supported custom provider, but RunWield cannot claim usage for a custom command that does not report it.

## Objective

Forward provider-reported `SessionRuntime` usage through the default Guided Review subprocess while it runs, aggregate
it on the Guided Review job, and show clear cumulative token and cost values in the code-review toolbar. Distinguish
usage that is pending from usage that the provider did not make available.

## Approach

Keep generated review JSON alone on standard output. The hidden `wld guided-review` command will subscribe to its
Session's existing `usage` events and write one versioned control line to standard error for each event:

```text
RUNWIELD_GUIDED_REVIEW_EVENT {"version":1,"type":"usage","usage":{...}}
```

The Workspace subprocess adapter will consume standard output and standard error concurrently. For the default `wld`
provider, it will parse only correctly prefixed control lines, send each usage value to the active job, and retain all
other standard-error text for normal failure reporting. The job will add each event to cumulative input, output,
cache-read, cache-write, and USD-cost totals and publish a new job snapshot immediately. The browser's existing polling
then receives the updated running job.

```text
SessionRuntime usage event
  -> hidden command control line
  -> subprocess progress callback
  -> cumulative Guided Review job usage
  -> job snapshot / stream
  -> toolbar status
```

Usage states will be explicit:

- `pending`: the default `wld` process is running but no provider usage event has arrived;
- `available`: at least one event arrived, including a valid all-zero event;
- `unavailable`: a custom command has no usage protocol, or the default process ended without a usage event.

The toolbar will use compact, stable formatting such as `tokens 1.2k in / 250 out / 800 read / 0 write · cost $0.125`.
It will show `tokens pending · cost pending` before the first default-runtime event and reserve `unavailable` for a real
absence of provider data.

The set-aside option was to return one result envelope after the subprocess exits. That is simpler, but it cannot update
a multi-call Guided Review while it is still running and would replace the current raw-review standard-output contract.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cli.ts` — keep the hidden command dispatch thin and delegate its expanded behavior to the command module.
- `src/cmd/guided-review/index.ts` — own the hidden Guided Review command, subscribe to adapter-neutral Runtime usage,
  emit versioned usage control lines, preserve raw review JSON on standard output, and always unsubscribe and close the
  ephemeral Session.
- `src/cmd/guided-review/index.test.ts` — run the command core through the real `SessionRuntime` and runtime-command
  model fixture, and prove a provider usage event becomes an exact protocol frame before command completion.
- `src/ui/workspace/routes/api/review-agent-handlers.js` — stream and parse default-provider control lines, aggregate
  job usage, track pending/available/unavailable state, and publish progress without changing the explicit
  custom-command contract.
- `src/ui/workspace/react/CodeReviewSurface.tsx` — render the job's explicit usage state and formatted cumulative values
  instead of testing object truthiness or printing raw JSON.
- `src/ui/workspace/react/guided-review-status.ts` — provide a small typed formatter for usage state, token counts, and
  USD cost so zero values and pending values have deterministic browser behavior.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — expose representative pending and available usage in the existing Code
  Review development surface for headed-browser verification.
- `src/ui/workspace/workspace-review.test.js` — cover the subprocess control protocol, live job aggregation, terminal
  state, custom-command compatibility, zero usage, and failure behavior through the real review route boundary.
- `src/ui/workspace/react/guided-review-status.test.ts` — cover the exact pending, unavailable, available, zero, and
  compact-number status output.

`src/shared/session/session-runtime-events.js` is deliberately outside the expected behavior change. Its
`RuntimeEventTypes.USAGE` and normalized `RuntimeUsage` shape already contain the required facts. This change forwards
that source of truth instead of adding a duplicate Runtime usage API.

No design-system CSS change is expected. The existing toolbar note and semantic tokens already support this text update.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js#subscribeSessionEvents` — receive usage from the ephemeral Guided Review
  Session through the public adapter-neutral Runtime contract.
- `src/shared/session/session-runtime-events.js#RuntimeUsage` — keep the existing input, output, cache-read,
  cache-write, and `costUsd` meanings across the command boundary.
- `src/ui/tui/chat-footer.ts#createChatFooterController` — follow the established cumulative usage rule: add every
  Runtime usage event and treat an emitted zero as reported data.
- `src/ui/workspace/routes/api/review-agent-handlers.js#broadcastJobs` and `snapshotJobs` — publish live cumulative
  values through the existing job API and event stream.
- `src/ui/workspace/react/CodeReviewSurface.tsx#waitForGuideJob` — keep the current 750 ms browser polling path; no new
  browser transport is necessary.
- The existing subprocess boundary in `runConfiguredGuideCommand` — extend this genuine external-capability boundary; do
  not add a seam for SessionRuntime, job state, or review generation.

## Implementation Steps

- [ ] `src/cli.ts` delegates `guided-review` to a Deno-native TypeScript command module, and the command still accepts
      the review request on standard input and emits only the generated Guided Review JSON on standard output.
- [ ] The hidden command subscribes before `promptSession` starts and emits one prefixed, version-1 control line for
      each `RuntimeEventTypes.USAGE` event. It forwards the normalized numeric fields without estimates, private prompt
      data, transcript content, or model output, and it removes the listener before closing the Session.
- [ ] The default subprocess adapter drains standard output and standard error concurrently, so a verbose child cannot
      deadlock. It parses only the internal prefix when the selected provider is `wld`; malformed internal frames fail
      clearly, while ordinary standard-error lines remain available for the existing non-zero-exit error.
- [ ] The adapter reports each parsed usage event before the subprocess settles. It does not reinterpret stderr from an
      explicit `RUNWIELD_GUIDED_REVIEW_COMMAND`, and custom command stdout remains the generated review body.
- [ ] Each Guided Review job has an explicit `usageState`. Default `wld` jobs start `pending`, become `available` on the
      first event, and become `unavailable` only if they finish without one. Custom jobs start `unavailable` unless
      their existing injected command result supplies usage. Failed or killed jobs retain any partial reported totals.
- [ ] Job aggregation sums input, output, cache-read, cache-write, and `costUsd` across all events. A reported all-zero
      event is `available`; no truthiness check converts it to unavailable. Every update is visible from both job
      snapshots and the existing server-sent event stream.
- [ ] The browser formatter renders cumulative values with compact token units and a stable USD value, renders pending
      and unavailable as different states, and never uses `JSON.stringify` for user-facing usage. Existing status,
      provider/model, and elapsed-time text remains present.
- [ ] The Code Review development surface can show a running pending state and a completed reported-usage state without
      a real model call. Standalone and in-Workspace presentations use the same status formatter.
- [ ] A command integration test uses `withRuntimeCommandFixture` and a real `SessionRuntime` turn, not a fake Runtime,
      to prove the hidden command receives provider usage, writes the versioned frame, preserves the exact review JSON,
      and cleans up its listener and Session.
- [ ] Behavioral route tests prove that a default-provider usage frame updates a still-running job before its result
      resolves, a second frame produces cumulative totals, zero usage remains available, final totals remain on a done
      or failed job, and an uninstrumented custom command remains unavailable while its review output still succeeds.

## Approval Confirmation

This Plan does not supersede a Work Record. The earlier Guided Review Work Record remains valid; this Plan fixes a
telemetry forwarding defect in that delivered behavior rather than replacing its planning guidance.

## Verification Plan

- Automated command, protocol, and route coverage:
  `deno run -A scripts/run-tests.js src/cmd/guided-review/index.test.ts src/ui/workspace/workspace-review.test.js src/ui/workspace/react/guided-review-status.test.ts`
- Automated Runtime contract coverage:
  `deno run -A scripts/run-tests.js src/shared/session/session-subscribers.test.js src/shared/session/session-runtime-events.test.js`
- Automated browser type check: `deno task workspace:check`
- Automated architecture check: `deno task seams:check`
- Full repository verification: `deno task ci`
- The command integration test must use the repository's real runtime-command model fixture and `SessionRuntime`. It
  must fail if the hidden command does not subscribe to `RuntimeEventTypes.USAGE`, does not emit the exact versioned
  frame, or mixes protocol data into the generated review JSON on standard output. A pure encoder-only test is not
  sufficient.
- The key route test must launch a job with a subprocess fixture that writes one valid internal usage frame, waits on a
  gate, and writes valid Guided Review JSON only after the test inspects the running job. The running snapshot must
  already contain the reported values and `usageState: "available"`. This fails against the current buffered,
  usage-dropping implementation and cannot pass through a final-only result envelope.
- A second frame must increase every cumulative field exactly once. This catches a pass-through implementation that
  exposes only the latest event and a parser that replays a frame after process settlement.
- A zero-valued frame must render numeric zero tokens and `$0.000`, not unavailable. A default process with no frame and
  a successful explicit custom command with no usage must both finish with unavailable usage, not fabricated zero cost.
- Existing behavior to preserve: the default provider is RunWield Core through `wld guided-review`; explicit custom
  commands remain supported; review JSON validation, widget registration, cancellation, timeout, metrics redaction,
  Plan/diff grounding, Guided Review rendering, annotation, feedback, and approval behavior remain unchanged.
- Behavior expected to stop existing: a default Guided Review job reports unavailable token and cost data after
  `SessionRuntime` emitted usage, and running default jobs label not-yet-reported values as unavailable.
- Manual headed-browser check: run `deno task workspace:dev`, open `http://127.0.0.1:5173/dev/code-review` and
  `http://127.0.0.1:5173/dev/workspace/code-review`, then use the Guided Review development variants. Confirm pending
  and available text is readable without changing toolbar height, covering the action button, or breaking narrow desktop
  layout. Confirm the completed state shows compact token categories and a USD cost, including reported zero values.
- Manual real-provider check: launch a local validation Code Review with the default `wld` provider, generate a Guided
  Review, and confirm the toolbar changes from pending to provider-reported cumulative values as Runtime events arrive;
  the final values remain visible after the Guided Review opens.

## Edge Cases & Considerations

- Providers normally report usage at a completed model-response boundary, not for every streamed token. `pending` can
  remain visible through a single-call generation until that call completes; the UI must not claim a live estimate.
- A Guided Review can make more than one model call. Totals are job-scoped sums, not the latest call and not the whole
  parent validation Session.
- Cost can be a valid zero for a local, subscription-backed, fixture, or zero-priced model. Event presence, not numeric
  truthiness, decides availability.
- A process can fail after one or more usage events. Keep the partial actual totals with the failed status; do not
  relabel them as full successful-generation cost.
- Standard output can contain multiline review JSON. Keeping control frames on standard error preserves the current
  parser and prevents model text from being mistaken for protocol data.
- An explicit custom command can write arbitrary standard error. Do not parse the internal protocol for that provider;
  this avoids accidental or hostile control-frame interpretation.
- Cancellation must close stdin, stdout, and stderr handling and must not leave a pending stream reader, Runtime
  subscription, job stream, or child process.
- This change introduces no new domain term and does not change `docs/domain-language.md`.
