# PRD Format

PRDs live in `docs/prd/<feature-name>.md`. Read this guidance before writing or revising a PRD, or deriving an Epic or
Plan from one. Preserve the user's decisions and existing substantive content when revising a document.

Use the structure below as the default. Scale the detail to the product question; headings are a guide to a coherent
proposal, not a reason to invent content. Existing PRDs may organize the same information differently. Do not copy an
old PRD's implementation-heavy sections merely because they already exist.

## Document Roles and Lifecycle

Five **living central PRDs** provide current product principles and lasting requirements:

- `docs/prd/runwield.md`: product vision and relationships across the product family.
- `docs/prd/runwield-core-prd.md`: shared local workflow and Core behavior.
- `docs/prd/runwield-connect-prd.md`: external-host use and compatibility promises.
- `docs/prd/runwield-acp-protocol-prd.md`: external ACP clients, protocol compatibility, and chat-channel integration.
- `docs/prd/runwield-workspace-prd.md`: browser, personal continuity, and later team collaboration.

Mark each with **Document role: Living central PRD.** Keep them concise and current; link to the central owner of shared
requirements instead of duplicating policy across all five.

Other PRDs are **transient feature proposals**. They remain while the feature is being shaped or implemented. After
implementation, fold lasting product requirements and meaningful unresolved scope into the relevant central PRD, update
references, then remove the completed feature PRD. Do not keep a `done/` PRD archive. Git history preserves the
original; Work Records record what shipped. Do not delete an unfinished proposal or imply it shipped simply because its
Plan exists. Completion is a reason to consolidate, not to lose unique product requirements.

Central PRDs guide product decisions; they are not inventories of source code, implementation gaps, or historical
choices. Preserve explicit user decisions and identify future scope separately from supported behavior.

## Template

```md
# <Product or Feature Title>

## Background

One paragraph: what this is, the initial context, the key problem, and why we want to address it.

## Problem Description

Explain how users are underserved today, the pains observed, and the evidence behind them. State the goals and
non-goals. For internal work, explain the operational problem; for a business initiative, identify the acquisition,
activation, retention, revenue, cost, or other product goal. Distinguish observed facts from assumptions.

## Why Are We Building It?

Describe the outcomes this enables: user journeys unlocked, value to the user, contribution to business goals, and the
improvements we expect. Explain why the work matters now. Connect each major feature to an outcome rather than listing
features as their own justification.

## Audience

Name the intended users and their relevant situations, needs, and constraints. Distinguish the primary audience from
secondary beneficiaries or buyers when that matters. State who the initial version is for and who is outside its scope.

## Product Fit, Prototypes, and Descriptions

Describe where this fits in the existing product, how users discover it, and the main journey before and after the
change. Use user stories or concrete scenarios to explain the expected behavior and important experience choices.

Link available prototypes, wireframes, screenshots, design-system references, or examples from other products. Explain
what each reference demonstrates and which parts apply. Label inspiration and proposed designs separately from existing
product behavior. If visual references are not available, describe the experience clearly; do not invent links or make
producing a prototype an automatic prerequisite.

## Success Metrics

Explain what success looks like and how we will measure it. Choose a small set of outcome measures relevant to the
problem, such as successful journey completion, time to first value, adoption, retention, or reduced support effort. For
each, state the baseline and target when known, the evidence or measurement method, and the observation period when
agreed. Mark unknowns as open rather than inventing numbers or requiring a new analytics system.

Include representative, non-exhaustive acceptance criteria for the essential user journeys. These show that the feature
works; the outcome measures show whether it helped. Detailed test cases and commands belong in implementation Plans.

## Delivery

Define the smallest useful release or MVP and how users will receive it. Describe meaningful milestones, any staged
rollout or pilot, and the dependencies that affect shipping. State what ships first and what is deliberately deferred.

Link the implementing Plan for a bounded change or the Epic for work requiring several coordinated Plans when those
artifacts exist. Otherwise identify the expected planning handoff without creating an Epic, dates, or implementation
commitments merely to fill this section. Milestones describe usable outcomes, not modules, database migrations, or task
checklists.

## Attached Research and Other Evidence

Link or attach the research and evidence supporting the proposal: user interviews, observed pain points, usage data,
support requests, experiments, competitive research, or other relevant material. Summarize what each source supports and
any limits or uncertainty. Distinguish direct observations from hypotheses and references used only for inspiration.

## Risks and Mitigations

Brainstorm what could go wrong with the team and relevant partner teams. Consider risks to the user experience,
adoption, business outcomes, delivery, and dependencies. For each material risk, describe its likely impact and an
appropriate mitigation; identify the responsible person or team when agreed. Keep mitigations proportionate to the risk,
and distinguish input actually received from assumptions still needing discussion.

## Open Questions

Collect unresolved questions while the spec is in progress. Note what decision or evidence would resolve each one, who
can help when known, and whether it affects scope, delivery, or how success will be judged. As answers arrive,
incorporate them into the relevant section and remove the resolved question. Do not let this become a permanent
discussion log.
```

## Supporting Material

Add other sections only when needed to understand the proposal, such as sourced product constraints or proposed domain
language. Keep proposed terminology distinct from the implemented glossary. Link architectural decisions for rationale
and constraints; link Plans for implementation details and remaining work. Do not turn supporting material into a second
implementation specification.

## Product Requirements

A PRD defines what users need, why it matters, and how success will be judged. It is not an implementation design. Apply
this distinction when reading, writing, or turning a PRD into an Epic or Plan.

- Start with the problem, intended users, business goal, and expected value.
- Describe the user's journey and stories: "As a [user], I can [action], so that [benefit]." Plain scenarios are equally
  useful; do not force every requirement into a template.
- State observable outcomes, scope, exclusions, and acceptance scenarios. Use agreed success measures; do not invent
  latency targets, delivery guarantees, or additional product obligations to make a document look complete.
- Include technical constraints only when they are explicit product commitments or necessary external constraints.
  Explain their user impact and source. Put internal architecture in an ADR or technical design, and implementation
  steps in the Plan. Link to those documents instead of copying their machinery into the PRD.
- Locks, database schemas, transaction phases, internal APIs, file layouts, and recovery algorithms are implementation
  choices. They are not user stories or success measures. For example, "I can continue on my phone while my idle TUI
  stays open, and see the reply when I return" is a product requirement; "acquire a fenced activation lease" is not.
- Separate current capability, known implementation gaps, and desired behavior. A temporary rollout restriction, old
  test, archived Plan, Work Record, or retrieved memory does not turn an implementation limitation into product intent.
  Check current source and architectural guidance, then apply the user's current decision.
- Architect and Planner preserve the PRD's scope when designing the solution. A best-effort notification does not imply
  a persistent acknowledgement system; one user changing screens does not imply simultaneous multi-user collaboration.
  Reuse existing Core behavior before proposing another state model or coordination layer.
- Keep the PRD concise enough for the owner to review. Before finalizing it, check that each requirement explains a user
  need, an observable outcome, or a sourced product constraint. Move implementation detail to the appropriate document.
