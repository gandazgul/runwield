# Product Requirements Document: Selective Execution Model Adaptation

Last updated: 2026-07-18 11:23 EDT

## Objective

Provide first-class support for selected local or smaller models in Engineer and Operator Agent Sessions through
explicit, evaluated Model Adaptation Profiles.

A profile should improve execution safety and convergence without changing RunWield's workflow ownership, Plan
Lifecycle, validation requirements, or behavior for Agent/model combinations that do not select it.

## Problem Statement

The same Agent Definition and generic Pi tool surface do not produce equally reliable behavior across models. RunWield's
Router evaluation already shows that some smaller models understand the task but fail the role contract through
excessive discovery, missing terminal tools, fake tool calls, or poor stopping discipline.

Little-coder demonstrates that model-facing scaffolding can materially change small-model coding performance. Its
mechanisms include strict Write/Edit behavior, read-before-edit enforcement, bounded recovery guidance, response-quality
monitoring, thinking limits, malformed-tool recovery, and selective skill injection. Its benchmark supports the combined
scaffold-model-fit thesis, but does not establish that every mechanism benefits RunWield or stronger models.

RunWield needs a way to support tested Agent/model combinations selectively, measure each intervention, and avoid a
global "small-model mode" that silently changes every Agent Session.

## Resolved Assumptions

### Selective First-Class Support

- Local and smaller models are first-class only for Agent/model combinations RunWield has evaluated and documented.
- The initial pilot targets Engineer and Operator.
- Router, Ideator, Planner, and Architect retain their current model-quality expectations until separate evidence
  supports a profile for them.
- Provider compatibility does not imply Agent-level support.

### Explicit Activation

- A Model Adaptation Profile is selected explicitly through an Agent/model preset or equivalent reviewable setting.
- RunWield may recommend a tested profile for a recognized model, but must not silently infer one from provider, model
  name, parameter count, cost, or local/cloud status.
- Manual model selection without a profile continues to use standard RunWield behavior.
- The effective profile should be visible in session diagnostics and exports so behavior is explainable.

### Workflow Semantics Stay in Core

- Profiles may shape prompts, tools, recovery feedback, and bounded model-facing interventions.
- Profiles must not own Routing Intent, Agent switching, Plan Status, Task Completion interpretation, validation,
  worktrees, recovery, or Runtime event publication.
- Protected tools and Core workflow invariants remain effective under every profile.
- Operator remains non-code execution ownership; a profile must not let Operator repair source code instead of
  performing Scope Escalation.

### Profiles Are Bundles of Independent Interventions

- A profile is a named support policy, not one monolithic prompt.
- Each intervention should be independently observable and removable for evaluation.
- Disabled profiles should not add irrelevant instructions, tools, or event hooks to ordinary Agent Sessions.
- Interventions should return actionable recovery guidance rather than generic refusal whenever safe recovery exists.

### Initial Execution Experiments

The first pilot should evaluate:

1. **Create-versus-modify discipline** — prevent accidental destructive whole-file replacement of existing files while
   preserving an explicit path for legitimate intentional replacement.
2. **Edit freshness** — prevent or recover from edits based on guessed or stale file contents without forcing redundant
   reads when equivalent current code evidence is already available.
3. **Bounded recovery output** — replace context-heavy failure dumps with the smallest useful diagnostic, source
   excerpt, and next action.
4. **Role-aware response health** — detect empty completion, missing required terminal signals, repeated identical
   calls, or clear non-progress, then apply a bounded correction rather than an infinite nudge loop.
5. **Intervention observability** — record whether a guard fired, whether the Agent recovered, and whether validation
   ultimately passed without storing private content.

The universal context watchdog belongs to Session Context Resilience, not this profile.

### Deferred Mechanisms

Hard thinking-token caps, broad malformed-tool parsers, algorithm/knowledge injection, and general-purpose Delegated
Agent Session dispatch are deferred until evaluation identifies a relevant failure and a credible scorecard. They should
not enter the initial profile merely because little-coder uses them.

### Evaluation Before Graduation

- Every profile begins experimental.
- Candidate interventions are compared with the same Agent/model baseline using Agent Behavior Evaluation.
- Graduation requires a material improvement in completion or validation outcomes without unacceptable regressions in
  safety, scope discipline, latency, context use, or user interruption.
- RunWield may support different profiles for different models; there is no requirement to converge on one universal
  local-model policy.

## Product Experience

Users should be able to choose a named model preset that clearly states:

- which Agents it supports;
- which model each supported Agent uses;
- which Model Adaptation Profile is active;
- whether the profile is experimental or supported;
- known limitations and expected resource requirements.

When an intervention occurs, the Agent receives concise recovery guidance. Users should see intervention detail only
when it explains a delay, refusal, repeated recovery, or final failure. Strong-model users who did not select the
profile should experience no additional ceremony.

## Functional Requirements

- Resolve an explicit Model Adaptation Profile per Agent Session alongside existing model, thinking-level, and
  temperature resolution.
- Compose only the profile mechanisms allowed for the active Agent and model preset.
- Keep effective profile identity available to Runtime snapshots, diagnostics, debug logs, and evaluation reports
  without leaking secrets.
- Enforce profile interventions at the model/tool boundary rather than relying only on prompt instructions.
- Cap automated corrections and fail transparently when the Agent does not recover.
- Preserve cancellation, replay, tool-event, and validation semantics through SessionRuntime.
- Record privacy-safe intervention counters through opt-in metrics and detailed outcomes during deliberate evaluation
  runs.
- Allow an experimental profile or individual intervention to be disabled without changing the selected model.
- Document supported and unsupported Agent/model/profile combinations.

## Technical Approach

Build on RunWield's existing named model presets and layered extension/resource loading. Extend the effective Agent
Session policy conceptually so an explicit preset can select a bounded model-facing behavior profile in addition to the
model, thinking level, temperature, and vision fallback.

Interventions should be implemented at the narrowest boundary that can enforce them consistently across Pi built-in and
RunWield-provided tools. Their results must continue through RunWield's normalized tool and Runtime event contracts.
Profile composition must remain deterministic and inspectable.

The first reference profile should use one selected local execution model and a curated Engineer/Operator scenario set.
Ablation runs should compare the complete profile and each load-bearing intervention against the unadapted baseline.

## Success Criteria

- At least one explicit Engineer/Operator model preset demonstrates better validated task completion than its unadapted
  baseline.
- Destructive replacement attempts, guessed edits, and non-progressing loops decrease or recover more reliably.
- Profile interventions do not bypass Task Completion, Scope Escalation, Mechanical Validation, Workflow Validation, or
  worktree safety.
- Standard Agent Sessions remain behaviorally unchanged when no profile is selected.
- Users and evaluation reports can identify the effective profile and its support status.
- An intervention that does not show value can be removed without redesigning Core workflow architecture.

## Out of Scope

- A global automatic small-model mode.
- First-class small-model support for every Agent.
- Silent profile inference based on model metadata.
- Moving Plan Lifecycle or workflow orchestration into Pi extensions.
- Generic provider-specific tool-call parsing without an evidenced target model failure.
- Replacing model capability with indefinite retries or intervention loops.
- Public claims that all local models work equally well.

## Dependencies and Sequencing

Agent Behavior Evaluation is required before a profile can graduate from experimental support. Session Context
Resilience should be treated as universal Core reliability and measured separately so its benefit is not misattributed
to the execution profile.
