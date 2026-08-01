---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add a RunWield extension that re-anchors the active agent on its durable artifact after compaction, so Planner rereads its draft and Engineer rereads the Plan and Verification Plan."
affectedPaths:
    - "src/extensions/re-anchor/index.ts"
    - "src/shared/session/session.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/engineer.md"
createdAt: "2026-08-01T01:18:18-04:00"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
status: "draft"
---

# Re-Anchor Agents After Compaction

## Context

Long agent turns drift from their durable artifact, and compaction is where the drift becomes invisible. Two observed
failures share the shape:

- A Planner session that settled decisions conversationally can cross a compaction boundary and finalize a Plan that
  omits one, because the only authoritative copy was in the context window.
- All three blocking findings in a validation second pass were things the Plan states explicitly and the engineer lost
  while deep in code. The seam check that failed was in the Verification Plan and never ran.

Both prompts now say to reread the artifact — `planner.md` under **Revising an Existing Plan**, and the engineer prompts
under their verification steps. Neither has a trigger, and an instruction to reread after compaction is read by the very
context compaction just discarded.

RunWield already runs three pi extensions — `mnemosyne`, `cymbal`, and `snip` — registered through `extensionFactories`
at `session.js:1833`. pi's extension API exposes exactly the two events this needs, typed: `session_compact` (fired
after compaction, carrying `reason` and `willRetry`) and `context` (fired before each provider request, and able to
return a replacement `messages` array).

## Objective

After compaction, the active agent receives one message naming the artifact it must reread before continuing: draft Plan
for Planner, Plan plus Verification Plan for Engineer and Reviewer-Feedback Engineer, Epic for Architect.

Non-goal: forcing compaction earlier. Compaction is lossy, and the value is the re-anchor, not the compaction.

## Approach

A new `re-anchor` extension holds one flag. `session_compact` sets it, unless `willRetry` is true — an overflow-retried
compaction fires the event more than once for a single boundary. The next `context` event appends the re-anchor message
to the outgoing messages and clears the flag.

**An extension is the right seam, and the reason is not that RunWield already has three.** Compaction fires _mid-turn_
on `threshold` and `overflow`, so the next provider request after it is usually not a RunWield-built request at all — it
is the same turn continuing. Injecting at RunWield's own turn boundaries (`decoratedRequest`, `buildEngineerRequest`)
would therefore miss the common case entirely and land the re-anchor only on manual `/compact`. The `context` event is
the one seam that fires on the continuation request, which is precisely where the anchor has to land.

`session_before_compact` also carries `customInstructions`, which can ask the summarizer to preserve the artifact
pointer. That is a worthwhile complement and this Plan adds it, but it cannot be the mechanism: a summary is lossy and
model-dependent, so it may or may not comply. The injected message is the guarantee.

The extension factory closes over what it needs. `snipExtension` already establishes the pattern at `session.js:1835`
(`(pi) => snipExtension(pi)`), and `agentName` and `sessionCwd` are in scope at that point, so the extension gets its
agent identity at construction rather than through a state bridge back into workflow code.

The message is context, not instruction duplication: it names the file and the sections, and leaves the reason to the
agent prompt, so the two cannot drift the way `buildEngineerRequest` drifted from `engineer.md`.

## Files to Modify

- `src/extensions/re-anchor/index.ts` — new: the extension, its flag, and both handlers. TypeScript, since a new
  production `.js` under `src/` fails `deno task language-policy:check`.
- `src/shared/session/session.js` — register the factory alongside the existing three, closing over `agentName`.
- `src/shared/workflow/workflow-prompts.js` — `buildReAnchorMessage`, so agent-facing text stays where the rest lives.
- `src/agent-definitions/planner.md`, `engineer.md` — reconcile the existing reread wording so neither restates the
  injected message.

## Reuse Opportunities

- `src/extensions/mnemosyne/index.js` — the extension shape: default-export factory taking `pi`,
  `pi.on("session_start")` to capture cwd and project identity, state held in factory closure.
- `src/extensions/*/index.test.js` — the established pattern for testing an extension by driving its handlers directly.
- `src/shared/workflow/workflow-prompts.js` — `buildEngineerRequest` and `buildTriageReport` as the builder pattern.
- `plan-store.js` `loadPlan` — resolving the active Plan path for the message.

## Implementation Steps

- [ ] `src/extensions/re-anchor/index.ts` default-exports a factory registering `session_compact` and `context`
      handlers, and `session.js` pushes it onto `extensionFactories` closing over the active `agentName`.
- [ ] A `session_compact` event with `willRetry: true` leaves the flag unset, so one compaction boundary produces at
      most one re-anchor no matter how many times the event fires.
- [ ] The first `context` event after a settled compaction returns a `messages` array containing the re-anchor message;
      the following `context` event returns the messages unchanged.
- [ ] `buildReAnchorMessage(agentName, artifact)` in `workflow-prompts.js` returns per-agent text naming the artifact
      path and the sections to reread. An agent with no durable artifact returns null and nothing is injected.
- [ ] The `session_before_compact` handler supplies `customInstructions` asking the summary to preserve the active
      artifact path and settled decisions, without depending on it for correctness.
- [ ] A Delegated Agent Session receives no re-anchor: a delegated child has a brief, not a Plan.
- [ ] A handler that throws is caught inside the extension and leaves the turn unmodified, so a re-anchor failure cannot
      break a provider request.
- [ ] `src/extensions/re-anchor/index.test.ts` proves the retry skip, single-injection-per-boundary, per-agent artifact
      resolution, the delegated-session exclusion, and the throwing-handler containment.
- [ ] `planner.md` and `engineer.md` state the reread expectation once, with the injected message supplying only path
      and sections.

## Verification Plan

- Automated: `deno task ci`.
- Automated: `deno run -A scripts/run-tests.js -A --no-check src/extensions/re-anchor/index.test.ts`
- Automated: `deno task test:golden-tui` — a Golden scenario compacts mid-execution and asserts the re-anchor reaches
  the next provider request naming the Plan path.
- Manual: run a long Planner conversation to auto-compaction and confirm the next turn references the draft Plan path.
- Existing behavior to preserve: compaction itself, the `compactionFinished` TUI notification, `/compact`, Session
  Transcript continuity, and the three existing extensions. The re-anchor adds a message; it must not alter what
  compaction keeps or discards.
- Behavior expected to stop existing: an agent resuming after compaction with no pointer back to its artifact.

### Objective-Failing Checks

- `OC1` — `test -f src/extensions/re-anchor/index.ts` — the extension exists as TypeScript.
- `OC2` —
  `grep -q "session_compact" src/extensions/re-anchor/index.ts && grep -q "re-anchor" src/shared/session/session.js` —
  it is both written and registered; an unregistered extension never runs.
- `OC3` — `grep -q "buildReAnchorMessage" src/shared/workflow/workflow-prompts.js` — the message is a shared builder,
  not inline text destined to drift from the prompts.
- `OC4` — `deno run -A scripts/run-tests.js -A --no-check src/extensions/re-anchor/index.test.ts` — the retry skip and
  single-injection behavior are exercised.

## Edge Cases & Considerations

- **The re-anchor must not become a second instruction source.** This is the drift that put "use the edit tool" in code
  while the prompt said something else. The message names an artifact; the prompt owns the behavior.
- The `context` event can replace the entire message array. Append only; returning a rebuilt array risks dropping
  history, and this extension has no business editing anything but its own addition.
- `context` fires on every provider request including sub-agent and tool-continuation requests. Injecting on the wrong
  one puts a Plan pointer into a delegated child's context.
- Compaction during Workflow Validation repair means the active agent is Reviewer-Feedback Engineer, not Engineer. Its
  artifact is the Plan plus the open Review Issue Ledger.
- The extension API is upstream in `pi-mono/packages/coding-agent`. `ContextEventResult` and `SessionCompactEvent` are
  the two shapes this depends on; pin behavior against the vendored version.
- Registering a fourth extension touches session construction, which is on the path of every command. Registration
  failure must degrade to no re-anchor rather than failing session startup.
