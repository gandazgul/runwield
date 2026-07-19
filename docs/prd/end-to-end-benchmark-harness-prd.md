# Product Requirements Document: End-to-End Benchmark Harness

Last updated: 2026-07-18 11:42 EDT

## Objective

Create a RunWield-owned **End-to-End Benchmark Harness** that can run repeatable Agent and workflow scenarios through
production-representative boundaries, verify outcomes, compare configurations, and adapt established external benchmarks
without bypassing RunWield.

The first milestone should benchmark WLD-native end-to-end flows. Aider Polyglot over ACP should be the first external
adapter. Harbor / Terminal-Bench should follow after RunWield has a clean benchmark-container execution boundary.

## Problem Statement

RunWield has strong automated coverage for source behavior and a Router golden-set runner, but it does not yet have a
shared harness for complete model-driven workflows. Existing tests cannot answer questions such as:

- Does Router hand a User Request to the right Agent and stop?
- Does Engineer reach Task Completion and Mechanical or Workflow Validation?
- Does Operator finish operational work or perform Scope Escalation at the correct boundary?
- Does a Model Adaptation Profile improve validated outcomes rather than merely change tool-call patterns?
- Can a long Agent Session compact, continue, cancel, and recover without state corruption?
- Does the compiled `wld` product behave the same way as the in-process Runtime path?

Little-coder contains useful benchmark machinery for Aider Polyglot and Terminal-Bench: isolated task preparation,
deterministic verification, retries, resumable result files, pilot scripts, shell proxies, trajectory logs, and
intervention counters. Its transport is not reusable as RunWield's benchmark boundary because it launches raw Pi RPC,
manually loads little-coder extensions, replaces the system prompt, and bypasses RunWield's SessionRuntime and workflow
semantics.

RunWield needs a common benchmark core that can reuse external methodology while measuring the actual product.

## Relationship to Agent Behavior Evaluation

`docs/prd/agent-behavior-evaluation-prd.md` defines what RunWield should evaluate, how Agent contracts differ, how
support claims graduate, and which score dimensions matter.

This PRD defines the execution machinery that makes those evaluations repeatable:

- scenario lifecycle;
- production-representative runners;
- fixture isolation;
- deterministic interactions;
- event and outcome capture;
- checkpointing, repetition, and reports;
- external benchmark adapters.

The harness should remain general enough to execute future scorecards without embedding one Agent's quality rubric into
the runner core.

## Resolved Assumptions

### WLD-Native Workflows Come First

The first benchmark milestone should cover complete RunWield paths rather than begin with a public coding leaderboard.
Initial scenarios should include:

- Router to Guide for a read-only inquiry;
- Router to Engineer to Task Completion and Mechanical Validation;
- Router to Planner, Review Loop, Engineer, and Workflow Validation;
- Operator completion and Scope Escalation;
- cancellation during active work;
- mid-run context pressure, compaction, and continuation;
- resume and recoverable failure.

These scenarios are the primary RunWield product signal because they exercise role boundaries, structured Custom Tool
outcomes, Runtime events, interactions, validation, and lifecycle behavior together.

### One Scenario and Result Model, Two Runners

The harness should use one RunWield-owned scenario and result model with two production-representative execution paths:

1. **SessionRuntime runner** — runs in process for precise WLD-native workflow fixtures, deterministic semantic
   interactions, focused diagnostics, and fast iteration.
2. **ACP runner** — launches the compiled or source-run `wld acp` product as a black box, drives the public protocol,
   and verifies packaging, process, protocol, Runtime, and adapter behavior together.

The runners may expose different diagnostics, but they should report compatible scenario identity, configuration,
outcomes, failures, usage, timing, and captured semantic activity.

### Production Fidelity Over Benchmark Convenience

- The harness must use the normal Agent Definition, model resolution, protected tools, extensions, SessionRuntime,
  workflow orchestration, and validation paths.
- Benchmark prompts must not replace RunWield's system prompt or smuggle hidden workflow instructions into the Agent.
- A benchmark-only tool, interaction policy, or fixture dependency may exist when the scenario requires controlled
  input, but it must be explicit in the scenario result.
- No benchmark mechanism may become a backdoor that normal clients can use to bypass Plan review, validation, protected
  tools, or Scope Escalation.
- The evaluated Agent must not be able to read expected answers, labels, oracle solutions, or scoring fixtures through
  its normal tools.

### Deterministic Fixture Interactions

WLD-native workflows require user decisions such as interviews, validation-command selection, approval, and review.
Fixtures should provide an explicit interaction policy that:

- answers only interactions declared by the scenario;
- records every supplied answer or decision category;
- rejects unexpected interactions rather than choosing the first option silently;
- distinguishes user cancellation, unsupported interaction, timeout, and harness error;
- never changes normal production interaction behavior.

The initial ACP adapter may focus on workflows its public interaction surface can drive faithfully. Full FEATURE review
over ACP should wait for a production-valid semantic interaction path rather than auto-approving or creating remote
review shares as benchmark shortcuts.

### Isolation and Reproducibility

- Every scenario runs in an isolated temporary project or benchmark-provided sandbox.
- Scenario setup records the repository or fixture revision, model/provider identity, effective Agent Definition,
  selected model preset, Model Adaptation Profile, and relevant settings.
- One failed, timed-out, or canceled run cannot contaminate the next scenario.
- Repeated trials should start from equivalent filesystem and session state unless the scenario explicitly tests resume
  or recovery.
- External service, provider, model-server, sandbox, dataset, and verifier failures remain separate from Agent failures.
- The harness should checkpoint results incrementally so a long batch can resume without losing completed trials.

### Semantic Capture, Not Raw Pi Reconstruction

- The SessionRuntime runner should capture normalized Runtime events and workflow outcomes.
- The ACP runner should capture ACP responses, session updates, elicitations, stop reasons, and process diagnostics.
- The common result should preserve tool identity, status, duration, usage, Agent changes, interventions, terminal-tool
  outcomes, validation verdicts, and final workflow state when available.
- Reports may retain detailed benchmark trajectories in deliberate local output directories, but passive workflow
  metrics remain content-free and privacy-safe.
- Missing, interrupted, unscored, and infrastructure-failed runs stay visible in denominators and reports.

### JavaScript/JSDoc Common Core

- The RunWield-owned harness and adapters should follow the repository's JavaScript/JSDoc language policy.
- External harnesses may impose their own integration language or process contract, but that must remain a thin optional
  adapter rather than the shared evaluation core.
- Python code from little-coder should not be copied wholesale merely because its current benchmark runner is written in
  Python.

### External Reuse and Attribution

- Reuse benchmark datasets, task preparation, deterministic verification, retry semantics, and reporting patterns when
  they are methodologically appropriate.
- little-coder is Apache 2.0. Direct reuse of its source requires the applicable license text, attribution, NOTICE
  content, and prominent changed-file notices.
- Aider Polyglot, Exercism tracks, Harbor, and Terminal-Bench retain their own licenses, citations, and usage terms.
- RunWield should prefer canonical upstream benchmark fixtures and methodology over depending indefinitely on a copied
  little-coder snapshot.
- The current little-coder `benchmarks/aider_polyglot.py` on `main` is a partial scaffold and is reference material, not
  a complete maintained six-language runner.

## Initial Benchmark Portfolio

### Phase 1: WLD-Native End-to-End Suite

Build a small, curated suite that covers the highest-value workflow branches. Each scenario should have:

- an isolated project fixture;
- one User Request and any declared interaction responses;
- expected Routing Intent or starting Agent;
- expected terminal Custom Tools and workflow outcome;
- deterministic repository, command, or lifecycle verification;
- timeout and cleanup policy;
- Agent-specific scorecard supplied by Agent Behavior Evaluation.

The initial suite should be small enough to run frequently and inspect manually. Breadth should grow only after scenario
quality and failure classification are trustworthy.

### Phase 2: Aider Polyglot Over ACP

Use the canonical Aider Polyglot / Exercism exercises to measure code implementation and retry behavior. Adapt the
useful little-coder machinery:

- exercise preparation and protected test fixtures;
- language-specific verification commands and transforms;
- first attempt followed by bounded test-output feedback;
- atomic per-exercise checkpoints and resumable batches;
- pass-on-first, pass-on-retry, fail, timeout, and infrastructure outcomes;
- elapsed time, usage, turns, tool activity, interventions, and compaction counts.

Replace `PiRpc` with a RunWield ACP client that launches `wld acp`, initializes a session in the exercise directory,
submits the User Request, handles declared interactions, collects normalized updates, and closes the session.

The first adapter may target the QUICK_FIX/Engineer path. Its results measure implementation and adaptation quality, not
the full value of Plan-by-Default workflows.

### Phase 3: Harbor / Terminal-Bench

Add long-horizon containerized tasks after deciding how RunWield should operate against the benchmark environment.
Prefer installing and running normal `wld` inside the task container when its runtime dependencies and model access can
be supplied cleanly. A host-side shell proxy is an alternative only if it preserves realistic RunWield tool semantics
and is clearly identified in results.

Reuse Harbor's official runner, task registry, sandboxing, verifiers, and result conventions. Treat little-coder's
Harbor adapter as a design reference for command proxying, output normalization, timeouts, and metadata—not as the
RunWield transport.

## Functional Requirements

### Common Harness

- Select scenarios by name, tag, Agent, workflow, model, preset, or profile.
- Run one scenario or a resumable batch with configurable repetition and concurrency.
- Enforce per-scenario and per-operation timeouts and settle cancellation cleanly.
- Record effective configuration and fixture revision before the Agent starts.
- Capture semantic activity and final filesystem/workflow verification.
- Classify Agent failure, verifier failure, harness failure, infrastructure failure, cancellation, and timeout
  separately.
- Write incremental machine-readable results and a concise human-readable summary.
- Compare a candidate run against a fixed baseline and show improvements, regressions, variance, and missing results.
- Preserve enough local trajectory detail for diagnosis without writing private benchmark content into passive metrics.

### SessionRuntime Runner

- Create an isolated Hosted Session at the fixture's absolute project root.
- Install only the declared deterministic interaction policy.
- Exercise normal routing and workflow operations for the scenario.
- Capture Runtime events, snapshots, workflow outcomes, usage, and cancellation settlement.
- Close all sessions and processes even when setup, prompting, interaction, or verification fails.

### ACP Runner

- Launch `wld acp` with stdout reserved for protocol frames and stderr retained as diagnostics.
- Drive initialize, session creation, prompting, updates, declared elicitations, cancellation, and close.
- Correlate tool and message updates by their stable Runtime/ACP identities.
- Fail visibly on malformed protocol output, unexpected interactions, unsupported required capabilities, or process
  exit.
- Support the compiled binary and source-run development command without changing scenario semantics.

### External Adapters

- Keep benchmark-specific preparation and verification outside the common runner.
- Preserve canonical task instructions and verifier behavior unless a documented RunWield adaptation is required.
- Record every methodology deviation that affects comparability.
- Verify required dataset, sandbox, language toolchain, and model-server prerequisites before consuming model calls.

## Technical Approach

Organize the harness conceptually into four layers:

1. **Scenario catalog** — fixture source, requested workflow, declared interactions, timeout, cleanup, and verifier.
2. **Runner ports** — SessionRuntime and ACP implementations that emit one normalized run record.
3. **Evaluators** — Agent- and benchmark-specific deterministic scoring plus optional judge/human annotations.
4. **Reports and baselines** — incremental results, comparisons, summaries, and retained trajectory locations.

The common run record should be additive and stable enough for Router, execution, context-resilience, Aider, and Harbor
scenarios. Benchmark-specific detail can remain nested rather than forcing every adapter into one flat universal schema.

The first vertical slice should run one QUICK_FIX scenario through SessionRuntime and the compiled ACP process, verify
the same repository outcome, and compare their semantic results. This proves the common boundary before scaling the
fixture catalog.

## Success Criteria

- A small WLD-native suite repeatedly exercises complete routing, execution, interaction, validation, and Runtime
  reliability paths.
- The same scenario can run through SessionRuntime and ACP with equivalent intended workflow and repository outcomes.
- Failures are attributable to Agent behavior, verification, harness logic, or infrastructure rather than collapsed into
  one generic error.
- A candidate Model Adaptation Profile can be compared against an unadapted baseline using validated outcomes and cost.
- An Aider Polyglot pilot runs through `wld acp`, checkpoints results, retries failed tests once, and reports
  reproducible pass/fail outcomes.
- Long batches resume safely and do not silently drop timed-out or interrupted trials.
- External benchmark reuse complies with source and dataset attribution requirements.
- Normal RunWield users do not install benchmark dependencies or receive benchmark-only behavior.

## Out of Scope

- A public RunWield model leaderboard in the first release.
- Replacing Harbor, Terminal-Bench, Aider Polyglot, or their canonical verifiers.
- Benchmarking raw models without RunWield Agent and workflow behavior.
- Uploading trajectories, repositories, prompts, or results to hosted analytics.
- Automatic approval of arbitrary production interactions.
- Making Python a supported RunWield implementation language.
- Running the full Aider or Terminal-Bench corpus in normal CI.
- Treating one external benchmark as proof that every RunWield workflow is reliable.

## Dependencies and Sequencing

1. Stabilize the common scenario/result model with WLD-native SessionRuntime fixtures.
2. Add the ACP runner and prove parity on a narrow production workflow.
3. Use the harness for Session Context Resilience and Engineer/Operator adaptation experiments.
4. Add Aider Polyglot as the first external benchmark adapter.
5. Add Harbor / Terminal-Bench only after the container execution boundary is production-representative.

Agent Behavior Evaluation supplies scorecards and support policy. Session Context Resilience and Selective Execution
Model Adaptation supply the first cross-cutting capabilities evaluated by this harness.
