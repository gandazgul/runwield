# Planner Process Notes

Status: working design notes, not a PRD, Epic, implementation Plan, or approved specification.

Last updated: 2026-07-31 EDT

## Why This Discussion Started

The triggering example was
[`plans/split-workflow-validation-into-typescript-modules.md`](plans/split-workflow-validation-into-typescript-modules.md).
Its objective was to split a 3,945-line Workflow Validation monolith into responsibility-oriented TypeScript modules.
The resulting execution candidate instead:

- renamed the original monolith to a 3,945-line `entrypoints.ts`;
- created seven three-line responsibility-module placeholders containing `export {};`;
- used `@ts-nocheck` in the renamed implementation;
- exposed `any`-typed facade wrappers;
- added TypeScript types that were disconnected from, and in places inconsistent with, the runtime contracts;
- passed the Plan's listed compatibility-oriented checks.

This was primarily a planning failure, not an Engineer-behavior failure. Engineer followed a Plan that explicitly kept
the entry points together, allowed extractions to be deferred through an Engineer-judged escape hatch, and failed to
define verification that distinguished a real split from a rename plus placeholders. Workflow Validation may have caught
the omission later, but that is an expensive late correction for a defect that should have been rejected before Plan
review and execution.

The load-bearing goal is therefore to make Plans materially better before Engineer receives them.

## Settled Product Direction

### One Normal Planning Pipeline

Every executable `PLANNED_CHANGE` should follow the same planning pipeline regardless of declared complexity or Work
Kind:

```text
User request
  -> Planner establishes the initial outcome and scope
  -> first-class read-only Planning Researchers run in parallel
  -> Planner reconciles evidence and collaborates on consequential decisions
  -> Planner records the settled design contract
  -> clean-context Plan Finalizer materializes executable details
  -> independent Plan Quality Gate challenges the finalized Plan
  -> one user Plan Review
  -> Engineer executes the approved Plan
```

There should not be a Planner prompt branch saying to research only when work appears complex. The workflow is always
the same. Small changes naturally produce compact or no-material-impact findings; foundational changes produce deeper
evidence.

If review feedback materially changes the design, the revised design must travel through the same research,
finalization, and quality path before returning to review.

PROJECT work should use the corresponding Architect-level research and quality discipline, while remaining an Epic
rather than an executable implementation Plan. Each executable child later follows the complete Planner pipeline.

### Role Boundaries

#### Planner

Planner owns:

- the desired outcome and why it matters;
- scope and non-goals;
- product and user-visible behavior;
- compatibility and risk-tolerance decisions;
- architectural trade-offs and accepted direction;
- domain and System Model impact;
- preserved invariants and acceptance boundaries;
- collaboration with the user on consequential choices;
- reconciliation of research evidence into a coherent design.

Planner may name modules, interfaces, responsibilities, ownership, dependency direction, accepted seams, and accepted
ports. Planner does not own the concrete implementation checklist.

Planner's core questions should be:

1. Who owns this behavior or fact?
2. What must remain true?
3. How do behavior and data travel through the system?
4. Are we planning the right change?

#### Planning Researchers

Planning Researchers own current repository and environment truth:

- modules, interfaces, entities/resources/records, responsibilities, and ownership;
- call, data, event, state, and failure/recovery paths;
- actual seams, ports, adapters, dependency direction, and external constraints;
- contracts, signatures, schemas, versions, importers, and consumers;
- existing tests and what they genuinely prove;
- mechanical feasibility of every contemplated outcome;
- false-positive implementations and acceptance discriminators.

Researchers do not choose product scope, make architectural decisions for the user, or write implementation steps. Their
output is evidence for Planner and Finalizer.

#### Plan Finalizer

Plan Finalizer owns execution readiness:

- exact affected paths, symbols, schemas, and contracts;
- outcome-based, dependency-ordered implementation steps;
- valid intermediate states and sequencing;
- migrations, rollout, compatibility, and recovery details;
- required test changes and verification commands;
- requirement-to-verification traceability;
- objective-sensitive structural checks;
- prohibited substitutes;
- strictly bounded fallbacks with observable predicates.

Finalizer starts with clean context containing the Planner-owned design, reconciled research evidence, relevant project
artifacts, and read-only repository access. It should not receive or depend on the full Planner conversation.

Finalizer may correct evidence-backed paths, symbols, and signatures; sharpen wording; reorder dependent work; and
request more research. It may not change the objective, user-visible behavior, scope, non-goals, compatibility policy,
architecture choice, or risk tolerance. A missing consequential choice returns to Planner and the user.

Finalizer returns either a complete executable Plan or a structured insufficiency result. It must never silently fill a
design hole with an unsourced assumption.

#### Plan Quality Gate

Plan Quality Gate is independent from Finalizer. It does not edit the Plan or introduce design. Its question is:

> Could a cheap or incomplete implementation satisfy this Plan and all of its checks while the central promised outcome
> is absent?

It returns either a pass or structured findings routed to the correct owner:

- `research` for a missing or contradictory repository fact;
- `planner` for unresolved scope, outcome, or architecture;
- `user` for a consequential stakeholder decision;
- `finalizer` for incomplete postconditions, sequencing, or verification.

The authority and bypass policy of this gate remain unresolved; see **Open Questions**.

#### Engineer

Engineer executes the finalized, approved contract. Engineer should not be expected to repair foundational Plan
assumptions or mutate Plan checkboxes as execution state. Engineer updates current-truth documentation, including the
System Model, in the same implementation change that makes the new model true.

Engineer completion/lifecycle hardening and `/load-plan` continuation are useful defense-in-depth and recovery work, but
they are not the primary prevention mechanism discussed here.

## First-Class Planning Research

### Fixed Research Profiles

RunWield should formalize one hidden `planning-researcher` base definition with three stable profile overlays.

#### 1. Codebase Structure Researcher

Researches:

- current modules and their complete caller-facing interfaces;
- entities, resources, records, and important value types;
- responsibility, state ownership, and sources of truth;
- dependency direction and coupling;
- current seams, ports, adapters, and architectural constraints;
- relevant `CONTEXT.md`, System Model, ADRs, PRDs, architecture documents, Plans, and Work Records.

#### 2. Behavior Flow Researcher

Researches:

- representative production call stacks;
- data and event paths;
- state mutations, lifecycle transitions, and transaction ownership;
- process, network, filesystem, provider, and user/model interaction edges;
- error, retry, rollback, and durable recovery paths;
- tests that traverse the real composed behavior.

#### 3. Feasibility and Verification Researcher

Researches:

- whether every contemplated outcome is mechanically possible in the current system;
- exact contract, type, schema, version, environment, migration, and deployment constraints;
- which existing tests exercise real behavior versus mocked-away composition;
- the cheapest implementation that can appear green while omitting the objective;
- acceptance evidence that rejects stubs, aliases, empty modules, pass-through wrappers, disconnected types, unused
  configuration, unlinked documentation, fake transaction layers, and other counterfeit completion paths.

These lenses are intentionally generic across languages, frameworks, architectural styles, and Work Kinds.

### Research Agent Architecture

The current generic `delegate_agent` interface is not a sufficient foundational contract because it accepts only a mode
and free-text brief, launches one generic prompt, and returns unstructured assistant text.

The intended direction is a first-class planning-research orchestration capability:

- always launch the three read-only profiles as one parallel batch;
- keep generic delegation available for ad hoc tasks;
- use a common base definition plus profile-specific instructions;
- keep profiles hidden from `/agent` and ordinary routing;
- support bundled, home, and project layering/customization;
- allow customization of model, thinking, temperature, and additive project guidance;
- keep profile IDs, result schemas, no-write/no-delegation ceilings, and evidence rules non-overridable;
- inject a dedicated typed completion tool rather than parsing prose;
- prohibit recursive delegation;
- bind packets to the relevant Plan/design revision, repository baseline/tree, dirty-state caveat, and profile version.

A common result envelope should distinguish:

- verified facts with path/symbol/line evidence and confidence;
- inferences;
- profile-specific structure/flow/verification data;
- contradictions;
- unknowns;
- scope limits;
- an explicit `complete` or `insufficient` status.

Raw packets remain workflow/session evidence, not a second canonical Plan artifact. Planner produces a compact
reconciled synthesis containing only load-bearing evidence. Conflicting research claims are resolved by inspecting the
cited sources, not by voting among agents.

## Architecture Language for Planner and Researchers

RunWield is opinionated about planning rigor but must not impose a new architecture on existing brownfield codebases.
Agents should describe the architecture as found and propose a new pattern only when changing that architecture is an
explicit, accepted objective.

The planning vocabulary should be sharpened around these concepts:

- **Module**: a cohesive capability with an interface and implementation; not necessarily a file, class, package, or
  service.
- **Interface**: everything a caller must know to use a module correctly, including inputs, results, invariants,
  ordering, error modes, configuration, and relevant performance constraints.
- **Implementation**: behavior hidden behind a module's interface.
- **Seam**: a location where behavior genuinely varies without editing the caller. Tests alone do not justify exposing
  product-owned machinery as a seam.
- **Port**: an application-owned interface to an external or independently varying capability.
- **Adapter**: a concrete implementation or translation at a port or seam.
- **Entity**: a domain concept with stable identity and lifecycle; ordinary request/results/value shapes are not
  automatically entities.
- **Owner/source of truth**: the authority allowed to decide or mutate a fact.
- **Invariant**: a condition that must remain true during success, failure, and intermediate states.
- **Projection**: derived, cached, or display state that must not become authority.
- **Depth**: leverage delivered through a module's interface.
- **Locality**: the concentration of knowledge, change, bugs, and verification behind an interface.

Hexagonal architecture is a reasoning lens, not a required folder layout. The useful questions are what belongs inside
the application, what is external, where dependency direction should point, which interactions deserve ports, and which
state machines, transactions, persistence rules, locks, registries, and cross-component guarantees remain
application-owned machinery.

Do not create a port for every helper or wrapper. Do not use dependency injection to substitute owned invariants merely
because doing so makes a narrow unit test easier.

## Mechanical Feasibility Applies to Every Work Kind

Mechanical feasibility does not mean the work is trivial. It means the proposed outcome can concretely be achieved and
observed in the current system.

Every Plan's research should proportionally establish:

- **Addressability**: relevant paths, symbols, routes, settings, schemas, resources, or creation points exist.
- **Connectivity**: the current call/data/event graph can reach the proposed behavior.
- **Contract compatibility**: callers, signatures, schemas, types, versions, and migrations align.
- **Ownership**: the change goes through the authoritative owner and preserves owned invariants.
- **Sequencing**: intermediate states can compile, run, deploy, or migrate safely.
- **Environment**: required tools, permissions, services, fixtures, and runtime capabilities exist.
- **Observability**: success and failure can be distinguished from omission or a stub.
- **Recovery**: destructive, external, and stateful work has rollback, retry, or durable recovery behavior.

Examples by work kind:

- A bug fix traces the reproduction to a violated invariant and adds evidence that fails without the fix.
- A feature traces the user/API/event entry through authoritative state and effects.
- A refactor preserves behavioral contracts and adds structural proof that fails when the refactor is skipped.
- A dependency/configuration change proves the selected version or setting is actually consumed at runtime.
- A performance change has a reproducible workload, baseline, target, and regression guard.
- A security change identifies the trust/abuse path, authoritative check, negative cases, and safe failure.
- A data migration identifies authority, conversion/backfill, mixed-version state, idempotency, verification, and
  rollback.
- A documentation change identifies the canonical source, audience, navigation/examples, and link/build consistency.
- A UI change traces interaction, state, and rendering and defines browser/accessibility evidence.

## Planner-Owned Design Contract

Planner should record a design-oriented draft in the one canonical Plan artifact. Suggested Planner-owned sections:

- Context and Objective
- Outcomes and Non-Goals
- Resolved Product and Architecture Decisions
- Domain and System Model Impact
- Architecture Direction
- Preserved Invariants
- Acceptance Boundaries
- Reconciled Research Synthesis
- Open Questions or Explicit Assumptions

Planner should not write action-form implementation steps.

## Finalizer-Owned Execution Projection

Suggested Finalizer-owned sections:

- Affected Paths and Exact Contracts
- Current and Target Call/Data/State Paths where material
- Outcome Requirements with stable IDs
- Ordered Implementation Outcomes
- Migration, Compatibility, Rollout, and Recovery
- Required Test Changes
- Verification Matrix
- Prohibited Substitutes
- Structured Fallbacks

Plan steps should state postconditions rather than file-touch actions. For example:

> `R4`: `review-support.ts` owns and exports the named review-support functions. Those declarations no longer exist in
> `entrypoints.ts`, which imports them. Empty responsibility modules, aliases, or facade-only forwarding do not satisfy
> `R4`. Proof: symbol-ownership and dependency-direction checks plus the behavioral suite.

Every outcome must map to an objective or invariant and to completion evidence. Verification must be change-sensitive:
at least one check must fail when the central outcome is removed while incidental edits remain. "Nothing broke" is
necessary but not sufficient for new behavior, structural change, migration, or policy work.

Fallbacks may not be self-judged scope holes. A valid fallback names:

- an objective trigger;
- evidence that proves the trigger;
- who decides whether it applies;
- its bounded effect on the outcome;
- the resulting Plan state;
- whether Planner/user reconsideration is required.

If a fallback weakens or removes the objective, it is a Plan revision, not a successful implementation path.

## Plan Quality Gate

The existing Plan Quality Gate concept should be folded into the same product effort as Plan Finalization while
remaining an independent Agent/workflow phase.

Its adversarial check is a minimal-green simulation:

1. Remove the central promised outcome.
2. Leave compilation, CI, renamed files, moved tests, wrappers, and incidental edits green.
3. Identify exactly which acceptance check becomes red.
4. Reject the Plan if no check distinguishes the counterfeit from success.

Blocking finding categories should include:

- an objective can be omitted while all verification passes;
- action-only steps without required end states;
- unbounded `if implementation discovers...` clauses;
- unsupported or invented paths, symbols, signatures, schemas, or contracts;
- architectural labels without ownership and flow evidence;
- seams or ports that substitute product-owned machinery;
- types or schemas declared but not connected to implementation and callers;
- verification consisting only of compilation, regression, or stale-reference checks when the goal is new or structural;
- missing migration, intermediate-state, compatibility, or recovery handling where applicable;
- mixed objectives that cannot be independently implemented and proved;
- domain/System Model changes without current-truth documentation updates.

Gate output should contain severity, category, claim, cited evidence, required correction, and responsible owner. The
gate never silently repairs its own findings.

## Existing Product Work to Fold Together

- [`docs/prd/feature-plan-finalization-prd.md`](docs/prd/feature-plan-finalization-prd.md) already establishes one user
  review, Planner ownership of design, and a hidden clean-context Plan Finalizer.
- [`docs/vision/spec-kit-plan-quality-gate-prd.md`](docs/vision/spec-kit-plan-quality-gate-prd.md) already identifies
  ambiguity, missing verification, terminology drift, stale assumptions, code contradictions, and boundary risk before
  execution.

These should become one coherent planning-reliability product effort. The current Finalization PRD is framed around
FEATURE Plans and should be reconciled with current `PLANNED_CHANGE` terminology and the decision that the same
research/finalization/quality pipeline applies regardless of Work Kind or declared complexity.

## System Model Direction

This discussion briefly explored whether every project should maintain an entity model like RunWield's
[`docs/entity-model.md`](docs/entity-model.md). The settled direction is a broader generic **System Model**.

Artifact responsibilities:

| Artifact                     | Responsibility                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT.md`                 | Current canonical project language, avoided aliases, and concise stable relationships                                                            |
| System Model                 | Current identities/resources, lifecycles, cardinality, ownership, authority, projections, and other project-appropriate conceptual relationships |
| Architecture research packet | Change-specific modules, interfaces, seams, ports, adapters, flows, and feasibility evidence                                                     |
| PRD/Plan                     | Proposed future behavior and model until implementation makes it true                                                                            |

The System Model is broad enough for applications, libraries, CLIs, infrastructure, compilers, build systems, and
data/ML projects. It should not force all projects into strict domain-entity or ER-diagram modeling.

Every Plan should declare its Domain and System Model impact. A no-impact declaration should be explicit. A material
change should record stable requirement IDs and current-to-target facts covering identity, lifecycle, cardinality,
ownership, authority, persistence, projections, context splits/merges, and external relationships as applicable.

When implementation makes a new model true, Engineer updates the relevant `CONTEXT.md` and System Model in that same
implementation change. Proposed future truth remains in PRDs and Plans until then. Critical model facts remain enforced
in code/tests; the System Model is explanatory current truth, not executable authority.

Current RunWield follow-up evidence discovered during this discussion, but intentionally not changed here:

- `docs/entity-model.md` and `docs/architecture.md` currently contain cross-links whose relative paths resolve to the
  wrong locations.
- Plan-to-Work-Record cardinality is represented inconsistently between diagrams and `CONTEXT.md`.

These examples reinforce the need for co-change rules and model-consistency checks rather than a read-only convention.

## Secondary Recovery Ideas

These are valuable but not the load-bearing planning solution:

- Add a `/load-plan` action that resumes implementation from an implemented candidate, preserves the worktree, restores
  Engineer, and leaves input unsubmitted so the user can provide feedback.
- Prefer an explicit continuation/reopen transition over pretending the previous implementation attempt never existed.
- Keep Plan Markdown as specification rather than letting Engineer-owned checkbox mutation become execution truth.
- If execution progress is later made structured, store it in RunWield-owned workflow evidence rather than Plan body
  checkboxes.

## Open Questions

1. **Plan Quality Gate authority:** Should blocking findings prevent Plan Review from opening, with no direct bypass?
   The current recommendation is yes. A deliberate limitation would be expressed as a Planner-owned revision to the
   objective or acceptance boundary and then re-evaluated, not as `approve anyway`. This has not been decided.
2. **Advisory presentation:** Which non-blocking Quality Gate observations, if any, should appear in the user Review
   Loop?
3. **Research invalidation:** What exact Plan/design/repository changes invalidate all three packets versus allowing
   evidence reuse?
4. **First-class profile schema:** Final profile names, typed payloads, customization layers, and completion-tool shape
   remain to be designed.
5. **Canonical Plan section ownership:** Exact Planner-owned and Finalizer-owned section markers and regeneration rules
   remain to be designed.
6. **System Model convention:** Exact filename, format, initialization behavior, multi-context layout, and consistency
   validation remain future design work.
7. **Architect and Slicer integration:** The corresponding PROJECT research/quality flow and how Slicer seeds child
   Planner drafts need explicit design.
8. **Plan review revisions:** The exact loop for user annotations that affect design versus execution detail needs to be
   mapped.
9. **Evaluation:** Add behavioral planning evaluations using adversarial fixtures, including the original
   rename-plus-empty-modules failure, disconnected TypeScript contracts, configuration that is never consumed, fake
   transactional seams, and other green-but-absent outcomes.

## Non-Decisions

- No implementation changes have been authorized.
- No current PRD or Plan has been revised.
- The Quality Gate hard-blocking policy is not yet decided.
- This file preserves the conversation so design can resume without treating these notes as canonical product truth.
