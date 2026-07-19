# Product Requirements Document: Agent Behavior Evaluation

Last updated: 2026-07-18 11:23 EDT

## Objective

Create a repeatable, privacy-safe evaluation capability that measures whether a RunWield Agent/model configuration
fulfills its role contract and completes the surrounding workflow reliably.

Evaluation should let RunWield compare models, prompts, tools, extensions, and Model Adaptation Profiles using evidence
rather than intuition. The execution machinery is defined separately in `docs/prd/end-to-end-benchmark-harness-prd.md`.

## Problem Statement

RunWield's quality depends on the coupled system of Agent Definition, model, prompt, tools, Runtime behavior, workflow
orchestration, and validation. Mechanical tests can prove that code paths behave correctly, but they do not prove that a
model will perform Triage, stop discovery, call a required Custom Tool, edit safely, recover from a failed tool, or
complete an execution workflow.

The existing Router golden-set work demonstrates both the value and the limitations of behavioral evaluation. Agreement
on scored rows is useful, but timeouts, missing `triage_report` calls, repeated Bash attempts, excessive discovery, and
unscored rows are equally important. Other Agents currently lack an equivalent contract-oriented evaluation surface.

Selective local-model support and model-facing runtime interventions should not become product promises until RunWield
can show that they improve the target Agent contract without causing unacceptable regressions elsewhere.

## Resolved Assumptions

### Evaluate Agent Contracts, Not Generic Intelligence

- Each Agent has a distinct role contract and therefore a distinct scorecard.
- Router evaluation emphasizes bounded discovery, correct Routing Intent, terminal-tool compliance, and restraint.
- Engineer evaluation emphasizes scoped implementation, safe tool use, Task Completion, validation outcome, repair
  behavior, and absence of unrequested changes.
- Operator evaluation emphasizes task completion, self-verification, scope discipline, and correct Scope Escalation.
- Future planning-role evaluation should assess decision quality, evidence use, collaboration, and artifact quality
  without reducing nuanced work to one mechanical score.

### Workflow Outcomes Matter

- A plausible final answer is insufficient when the Agent contract requires a Custom Tool or lifecycle transition.
- Evaluation should include whether the surrounding Runtime and workflow reached the expected semantic outcome.
- Mechanical Validation and Workflow Validation are stronger execution verdicts than model self-report.
- Time, token use, context pressure, intervention count, and user-attention requests are product costs, not merely
  diagnostics.

### Mechanical Scoring First, Judgement Where Necessary

- Prefer deterministic scoring for tool calls, timeouts, retries, file scope, lifecycle outcomes, validation, and event
  contracts.
- Use model judges only for dimensions that cannot be scored mechanically, and keep their verdict separate from hard
  pass/fail facts.
- Human review remains the calibration authority for ambiguous quality dimensions and new benchmark sets.
- One composite score must not hide a severe contract failure.

### Evaluation Data Is Curated and Reviewable

- Evaluation scenarios should be versioned fixtures with expected outcomes or explicit human labels.
- Real historical requests may seed fixtures only after private or identifying content is removed.
- Fixtures must not be discoverable by the evaluated Agent through normal project tools.
- Synthetic scenarios should test known failure modes without pretending to represent real-world prevalence.
- Baselines should record model/provider version, Agent Definition revision, effective Model Adaptation Profile, and
  relevant Runtime configuration.

### Metrics and Evaluation Are Different Surfaces

- The existing opt-in workflow metrics stream may provide aggregate, content-free operational observations.
- Benchmark fixtures and detailed evaluation outputs belong to a deliberate evaluation run, not passive user telemetry.
- Raw User Requests, prompts, code, diffs, tool arguments/results, credentials, and private source content must not be
  copied into workflow metrics.
- No analytics sync is required; local evaluation is the initial product surface.

### Support Claims Require Evidence

- A model may be provider-compatible without being a supported choice for every Agent.
- A Model Adaptation Profile graduates from experimental to supported only after it beats an agreed baseline on its
  target contract and does not regress safety or workflow correctness.
- RunWield should publish limitations and unsupported Agent/model combinations plainly rather than infer quality from
  parameter count or provider identity.

### Reuse External Machinery Deliberately

- RunWield should reuse established benchmark datasets, task preparation, deterministic verifiers, retry semantics, and
  reporting patterns when their licenses and methodology are suitable.
- RunWield should not reuse a transport that bypasses SessionRuntime, Agent Definitions, protected tools, workflows, or
  Model Adaptation Profiles.
- little-coder's Apache-2.0 benchmark code is useful reference material. Directly reused source requires the applicable
  license, attribution, NOTICE content, and changed-file notices; external benchmark datasets retain their own licenses.
- RunWield-owned benchmark code should follow the project's JavaScript/JSDoc language policy. Python adapters should not
  become the common evaluation core merely because an external harness uses Python.
- Public external benchmarks complement RunWield-native Agent contract evaluation; they do not replace it.

## Initial Evaluation Portfolio

### WLD-Native End-to-End Workflows

The first milestone should exercise complete RunWield paths with deterministic fixture interactions:

- Router to Guide for read-only inquiry;
- Router to Engineer to Task Completion and Mechanical Validation;
- Router to Planner, Review Loop, Engineer, and Workflow Validation;
- Operator completion and Scope Escalation;
- cancellation, compaction, resume, and recoverable failure.

These scenarios are the primary product release signal because they measure RunWield's role and workflow semantics, not
only whether a model can edit code.

### Router

Build on the existing golden set and track at least:

- agreement on labelled rows;
- unscored and timeout rates;
- completion with exactly one `triage_report`;
- tool calls before Triage;
- repeated or forbidden tool attempts;
- discovery cost and duration.

### Engineer and Operator Pilot

Create bounded scenarios for the first selective execution adaptation work. Track at least:

- successful completion and required terminal-tool use;
- changed-path scope and destructive whole-file rewrites;
- read/edit recovery behavior;
- repeated identical or non-progressing tool calls;
- correction/intervention count and whether recovery succeeded;
- Mechanical or Workflow Validation outcome;
- Scope Escalation correctness;
- context interventions, elapsed time, and token use.

### Runtime Reliability

Use scenario harnesses for cross-Agent Runtime behavior such as:

- mid-run context pressure and compaction;
- cancellation settlement;
- replay parity;
- interaction handling;
- multi-session isolation.

These scenarios complement automated source tests; they do not replace them.

### External Benchmark Adapters

After the WLD-native suite establishes a stable scenario/result model:

1. **Aider Polyglot over ACP** should be the first external adapter. Reuse or adapt the exercise preparation,
   language-specific verification, two-attempt retry, resumable result, and reporting machinery. Replace little-coder's
   Pi-specific RPC transport with a RunWield ACP client so the compiled product, SessionRuntime, Agent handoffs, tools,
   and validation behavior remain in the measured path.
2. **Harbor / Terminal-Bench** should follow after RunWield has a clean benchmark-container execution boundary. Prefer a
   normal RunWield installation inside the task environment over a benchmark-only shell proxy when feasible.

The current little-coder `aider_polyglot.py` on `main` is partial and should be treated as source material rather than a
drop-in complete six-language runner. A RunWield adapter should verify behavior against the canonical Aider/Exercism
fixtures and licenses.

Black-box workflow fixtures must use an explicit deterministic interaction policy. They must not silently approve every
production interaction, and benchmark-only approval behavior must not leak into normal ACP clients.

## Functional Requirements

- Run one scenario against a chosen Agent, model, and effective configuration without using the normal user's persisted
  project data.
- Capture structured Runtime events, tool/lifecycle outcomes, validation verdicts, duration, usage, and intervention
  counters.
- Score deterministic contract dimensions and retain judge/human assessments as separate annotations.
- Compare a candidate against a fixed baseline and report both improvements and regressions.
- Support repeated trials where sampling variance matters.
- Time out and settle failed runs without contaminating later scenarios.
- Keep evaluated fixtures outside the Agent's searchable working context.
- Produce human-readable and machine-readable local reports suitable for review and baseline storage.
- Make unsupported, unscored, interrupted, and infrastructure-failed runs visible rather than dropping them from the
  denominator.

## Technical Approach

Build one RunWield-owned scenario and result model with two production-representative runners:

- an in-process SessionRuntime runner for precise WLD-native workflow fixtures and deterministic semantic interactions;
- a black-box ACP runner for compiled-product and external benchmark integration.

Agent-specific evaluators should supply scenarios and scorecards while the common evaluation core owns isolation,
timeout, event capture, usage accounting, repetitions, checkpointing, and baseline comparison. The ACP runner should
collect RunWield's normalized updates rather than reconstructing raw Pi events.

Evaluation should use the effective Agent Definition, tools, extensions, model preset, and workflow behavior rather than
a simplified mock prompt. External infrastructure, dataset, sandbox, interaction-policy, and Agent contract failures
must remain separate result categories.

Existing privacy-safe workflow metrics can provide field observations about intervention frequency and outcomes, but
benchmark decisions should remain grounded in curated reproducible runs. Optional external adapters may depend on their
native harnesses without making those dependencies part of normal RunWield installation or Runtime behavior.

## Success Criteria

- Router regressions are detected across both decision accuracy and completion discipline.
- Engineer/Operator adaptation experiments can be compared against an unadapted baseline with repeatable results.
- Reports expose hard failures, costs, variance, and qualitative judgement separately.
- A failed or timed-out scenario cannot poison subsequent runs.
- The evaluated path remains representative of production SessionRuntime and workflow behavior.
- RunWield can make a documented support decision for at least one execution Agent/model preset based on the results.

## Out of Scope

- A public model leaderboard.
- General-purpose LLM benchmarking unrelated to RunWield Agent contracts.
- Uploading user sessions or evaluation results to a hosted analytics service.
- Treating model-judge output as the sole release gate.
- Replacing automated unit, integration, architecture-boundary, or validation tests.
- Guaranteeing that one benchmark predicts every repository or user workflow.

## Dependencies and Sequencing

`docs/prd/end-to-end-benchmark-harness-prd.md` provides the shared scenario, runner, isolation, interaction, and
reporting machinery for these scorecards. This PRD remains the measurement and support-policy foundation for
`docs/prd/selective-execution-model-adaptation-prd.md`.

Session Context Resilience can develop in parallel, but its long-run scenarios should become part of this shared
evaluation portfolio.
