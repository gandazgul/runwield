# Product Requirements Document (PRD): RunWield

## 1. Vision & Strategy

**RunWield** is collaborative software planning with AI.

RunWield helps software teams figure out what to build, shape the work into reviewable Plans, execute approved work
through a local open-core harness, and preserve distilled records so future planning starts from what the team already
learned.

The product loop is:

```text
ideate -> plan -> execute -> record -> use records to plan better
```

RunWield should not be positioned as an agent management platform, issue tracker, ticket system, Scrum tool, or generic
AI chat product. Agents are implementation partners inside the planning loop, not the product category.

## 2. Product Architecture

### 2.1 RunWield Core

**RunWield Core** is the free local harness and runtime. It owns the canonical local workflow:

- local `wld` CLI
- interactive TUI
- local web UI clients
- Session Host and future ACP-compatible external clients
- Router, Ideator, Planner, Architect, Slicer, Engineer, Operator, Reviewer, Tester, and future Recorder agents
- local Plans, PRDs, ADRs, and Work Records as markdown artifacts
- local execution, validation, and recovery workflows

Core remains useful by itself. It should provide the full local loop for one project/repository without requiring the
hosted product.

The detailed implementation-facing Core requirements live in [runwield-core-prd.md](./docs/prd/runwield-core-prd.md).
This root PRD summarizes Core only enough to place it inside the broader RunWield product architecture.

### 2.2 RunWield Workspace

**RunWield Workspace** is the collaborative planning product. It is the SaaS layer for teams working across projects.

Workspace focuses on:

- Plan-centered collaboration
- shared backlog and in-progress planning flow
- collaborative Plan review
- PRD, ADR, and Work Record visibility
- cross-project planning memory
- relevant retrieval for new planning work
- optional governance around approvals and records

Workspace should not initially lead with hosted execution. Hosted AFK `wld` agents may become a later capability for
executing ready Plans, but the first SaaS wedge is collaborative planning and records.

The detailed Workspace product requirements live in [runwield-workspace-PRD.md](./docs/prd/runwield-workspace-PRD.md).
That PRD marries the local Plan management UI and encrypted collaborative planning directions into the self-hostable and
hosted Workspace story.

### 2.3 Naming

- **RunWield**: public product and umbrella brand.
- **RunWield Core**: free local harness.
- **RunWield Workspace**: collaborative SaaS product.
- **`wld`**: CLI command.
- **Wield**: acceptable shorthand after context is established.

Avoid public phrasing such as "Wield AI" because it risks brand collision and points toward the wrong category.

## 3. Core Philosophies

- **Planning is the category:** RunWield should own AI-native/collaborative software planning, not agent management.
- **Plan-by-Default:** Material work starts with a Plan unless it is explicitly a bounded operation or quick fix.
- **Artifacts over traces:** Durable team knowledge lives in Plans, PRDs, ADRs, and Work Records, not raw chat logs.
- **Private working space:** In-between user/agent conversations are private-first. Artifacts persist; chat minutia does
  not become team memory by default.
- **Local-first core:** Core artifacts are repo-local markdown first. Workspace enhances collaboration and cross-project
  intelligence without making the local harness dependent on SaaS.
- **Distilled memory:** Future planning should use approved/final records and rationale, not noisy intermediate debate.
- **Flexible team roles:** PMs, tech leads, and developers can collaborate however their team works. RunWield should not
  prescribe job-description boundaries.
- **Lightweight defaults, optional strictness:** Flow should be easy by default, with stricter approval and governance
  policies available for teams that need them.

## 4. Core Objects

### 4.1 Plan

The **Plan** is the central product object.

A Plan connects:

- product or technical intent
- the proposed approach
- review and approval state
- execution readiness
- validation outcome
- links to related PRDs, ADRs, and later Work Records through derived references

Plans are prospective: they describe what the team intends to do and how.

Plans remain markdown files with stable front matter in Core. Workspace can provide richer collaboration, but must not
erase the repo-local Plan model.

### 4.2 PRD

PRDs capture product intent, customer/user context, constraints, and desired outcomes. They should be first-class
planning inputs and can be created or refined through RunWield agents.

### 4.3 ADR

ADRs remain the authoritative artifact for architecture and technical decisions. Work Records and Plans may reference
ADRs, but should not become a parallel technical-decision authority.

### 4.4 Work Record

**Work Records** are retrospective planning-memory artifacts. They capture what was actually built, why the final
outcome matters, what was deferred, and what future planning agents or humans should remember.

Work Records are not raw review logs. Review history may exist for manual audit, but the planning-memory surface should
contain distilled final decisions and rationale so future LLM planning does not receive mixed signals.

Work Records should be:

- repo-local markdown in Core, likely under `docs/work-records/`
- generated automatically for verified planned work
- auto-approved by default
- optionally reviewed manually when a team enables stricter ceremony
- linked one-way back to one or more source Plans
- searchable and retrievable by relevance for future planning
- compressible or reorganizable later without mutating source Plans

Work Records should not be generated for no-plan `QUICK_FIX` work initially. Quick fixes are usually local, one-off, and
too granular for durable planning memory.

## 5. RunWield Core Requirements

This section is a product-level summary. See [runwield-core-prd.md](./docs/prd/runwield-core-prd.md) for the fuller Core
PRD that preserves the detailed local harness, TUI, routing, lifecycle, tooling, and validation requirements.

### 5.1 Session Host and Clients

RunWield Core must separate runtime session ownership from the TUI.

The **Session Host** is the non-TUI runtime boundary that owns one or more live RunWield Agent Sessions. The TUI, local
web UI, ACP clients, and future transports should all act as clients of the same core runtime boundary.

Core requirements:

- support multiple independent Hosted Sessions in one process
- preserve existing TUI behavior through the Session Host
- keep session state scoped per Hosted Session rather than process-global
- expose session create/load/prompt/cancel/observe semantics for non-TUI clients
- make ACP the strategic external integration contract

The local web UI is a Core client for people who prefer browser workflows or local UI surfaces over the TUI. It should
not be conflated with the SaaS product.

### 5.2 Router and Agent Workflows

The Router is the default triage Agent in Core. It is a peer Agent, not a special system wrapper.

Routing intents:

- `INQUIRY`: read-mostly understanding work
- `IDEATION`: product/research exploration and Socratic shaping before planning
- `OPERATION`: direct non-code repository or environment operations
- `QUICK_FIX`: bounded code implementation with no Plan file
- `FEATURE`: planned executable work
- `PROJECT`: Epic-scale work that is decomposed into child FEATURE Plans

Workspace planning flows may invoke Router with a planning-oriented route set and may also offer direct actions into
Ideator, Planner, or Architect when the user already knows what artifact they want.

### 5.3 TUI Shell and Agent Switching

The TUI remains a first-class Core client.

By default, a new interactive session starts with Router. After Router hands off to a specialist, the specialist remains
the active root Agent so follow-up messages keep useful context. Users can use `/new` for a fresh routed session or
`/agent router` to route another request in the same session.

Dynamic Agent switching should preserve:

- active Agent identity
- persisted session state
- pending handoffs
- model/thinking state
- workflow execution state
- project-state context

### 5.4 Routing and Lifecycle Tools

Routing and Plan lifecycle transitions are driven by declaration tools plus session-level orchestration. Agents declare
intent by calling tools; RunWield orchestration decides what happens next.

**`triage_report`**

- Router-owned.
- Emits routing intent, complexity, summary, affected paths, and optional session name.
- Ends the Router turn so orchestration can dispatch to the correct specialist.

Post-tool orchestration:

- `INQUIRY` -> Guide
- `IDEATION` -> Ideator
- `OPERATION` -> Operator
- `QUICK_FIX` -> Engineer with mechanical validation only
- `FEATURE` -> Planner and Plan workflow
- `PROJECT` -> Architect, Epic Plan workflow, and Slicer decomposition after approval

**`plan_written`**

- Planner/Architect-owned.
- Validates that a Plan file exists.
- Submits the Plan for review.
- Records approval, feedback, cancellation, readiness repair, save, or proceed decisions.
- Triggers the classification-aware readiness gate after approval.

### 5.5 Plan Lifecycle, Validation, and Recovery

Saved Plans are governed by an event-driven lifecycle. Workflow code records Plan Events; the Plan Lifecycle decides the
durable status and front matter updates.

Canonical statuses:

- `draft`
- `feedback`
- `approved`
- `ready_for_decomposition`
- `ready_for_work`
- `in_progress`
- `failed`
- `implemented`
- `verified`
- `closed_without_verification`
- `on_hold`

Lifecycle gates:

- **Review Gate:** Plannotator or Workspace approval records review events and feedback.
- **Readiness Gate:** FEATURE Plans promote to `ready_for_work`; PROJECT Epics promote to `ready_for_decomposition`,
  then `ready_for_work` when Slicer finalizes child Plans.
- **Execution Gate:** executable Plans start only from `ready_for_work`.
- **Implementation Gate:** successful implementation records `implementation_finished`.
- **Workflow Validation Gate:** executable FEATURE and legacy non-Epic PROJECT work runs local validation and semantic
  review before reaching `verified`.

PROJECT Epics are containers, not directly executable implementation work. Child FEATURE Plans validate independently.
An Epic may be marked done enough for now through the existing `epic_done_enough` flow, resulting in `status: verified`
with `epicCompletionMode: done_enough` and an `epicDoneEnoughSummary`.

Loading an `in_progress`, `failed`, or `implemented` Plan opens a recovery path. The user can inspect the scoped diff,
continue, reset to the captured execution baseline, re-open for review, or retry validation.

### 5.6 Work Record Generation

Core should add a future **Recorder** Agent.

Recorder requirements:

- run with fresh context after planned work is verified
- read the approved Plan or Epic, what was built, validation notes, and relevant artifacts
- produce a distilled Work Record
- auto-approve the Work Record by default
- support optional human review before approval when configured
- avoid copying raw review or chat minutia into the planning-memory surface

Generation policy:

- verified FEATURE Plan -> one Feature Work Record
- verified PROJECT Epic -> one Epic Work Record
- Epic marked done enough -> one Epic Work Record with informational `completionMode: done_enough`
- no-plan QUICK_FIX -> no Work Record initially

Child slices of an Epic are implementation details. The Epic Work Record should summarize the meaningful product or
technical outcome and may reference child Plans as source material when useful.

Suggested Work Record front matter:

```yaml
kind: work_record
recordId:
title:
description:
scope: feature | epic | project
status: approved | draft | superseded
approvalMode: auto | manual
completionMode: complete | done_enough
sourcePlans: []
relatedPrds: []
relatedAdrs: []
createdAt:
approvedAt:
createdBy:
createdWithAgent:
lastEditedBy:
lastEditedWithAgent:
```

Stable front matter should reference only RunWield-controlled artifacts. Git-specific or external-process references
such as commits, pull requests, issues, deployment links, or customer notes can appear as loose markdown links in the
body.

Suggested body schema:

```markdown
## Summary

## Original Intent

## Final Outcome

## What Changed

## Referenced Decisions

## Validation

## Deferred Work

## Future Planning Notes

## Deep Links
```

Future Planner, Architect, and Ideator agents should retrieve only relevant Work Records by default. Initial retrieval
can search Work Record titles, descriptions, and headings, then follow `sourcePlans`, `relatedPrds`, `relatedAdrs`, and
body links when deeper context is needed.

## 6. RunWield Workspace Requirements

### 6.1 Primary Surface

Workspace's main screen should be Plan-centered.

Primary areas:

- Ideas
- Planning
- Review
- Ready
- In Progress
- Verifying
- Done
- On Hold

These are product-facing states for PMs, tech leads, and developers. Raw Core lifecycle statuses can remain visible in
detail views for transparency and debugging.

Natural actions from the Plan screen:

- start a new idea
- create or refine a PRD
- create a Plan
- create an Epic
- review a Plan
- inspect Work Records and planning memory

Searching Work Records is important, but secondary to the Plan workspace.

### 6.2 Collaboration and Privacy

Workspace should persist durable artifacts, not raw planning conversation minutia.

Requirements:

- Plans, PRDs, ADRs, and Work Records are team-visible artifacts according to workspace permissions.
- User/agent working conversations are private-first by default.
- Individual chat messages should not be attached to Plans by default.
- Artifact metadata can store user and Agent authorship.
- Details screens can show quiet metadata such as author, drafting Agent, approval mode, and source references.
- Admin/debug session access may exist where policy allows.
- Product analytics should be anonymized and aggregated for RunWield improvement unless users explicitly opt into
  broader sharing.

### 6.3 Roles and Permissions

Workspace should start with minimal roles:

- **Admin**
- **Member**
- **Reviewer/Guest**

Do not encode PM, tech lead, or developer job-title roles by default. Teams should decide how strictly they divide
planning, architecture, and execution responsibilities.

Later, Workspace may allow more granular Member permissions, but this should not be required at launch.

### 6.4 Approval Gates

Workspace should use lightweight defaults with optional strictness.

Default behavior:

- Members can create and collaborate with minimal ceremony.
- Important Plans go through review.
- Work Records auto-approve after Recorder generation.
- Epics require explicit approval before decomposition/work.

Optional stricter settings:

- restrict who can approve Plans
- require Work Record review before retrieval
- require ADR links for architectural Plans
- require explicit approval before a Plan can enter Ready

### 6.5 Cross-Project Intelligence

The paid Workspace moat is shared cross-project planning intelligence.

Workspace should extend Core's repo-local records with:

- team-wide Work Record search
- cross-project retrieval for new Plans
- context packs for Ideator, Planner, and Architect
- compression/deduplication of older records over time
- answers to "what did we decide before?" across projects
- filtering by project, area, Plan type, completion mode, and status

This is a key reason to pay for Workspace. It should strengthen planning without reframing RunWield as hosted agent
management.

## 7. Advanced Core Capabilities

### 7.1 Memory and Indexing

- **Mnemosyne Integration:** project/global persistent memory for user preferences, project facts, and critical context.
- **Memory Maintenance:** cleanup and organization flows through built-in commands.
- **Code Intelligence:** structural and semantic project search through local tooling.
- **Project Brief:** compressed project context injected where useful without flooding every prompt.

RunWield should distinguish Mnemosyne-style operational memory from Work Records. Mnemosyne stores recallable agent
memory; Work Records are durable planning artifacts owned by the project/team.

### 7.2 Agent Specialization

Bundled Agents include Router, Guide, Ideator, Operator, Planner, Architect, Slicer, Engineer, Tester, Reviewer, and
future Recorder.

Users can customize Agents and load Skills, but customization should preserve protected workflow tools needed for Core
behavior.

### 7.3 Agent Tool Policy

Every Agent's capabilities are defined declaratively via YAML front matter in its Agent Definition file.

Layered override precedence:

1. local project overrides: `./.wld/agents/<agent>.md`
2. home overrides: `~/.wld/agents/<agent>.md`
3. bundled defaults: `src/agent-definitions/<agent>.md`

Each layer that defines a `tools` list replaces lower-layer tools. Prompt bodies append by default unless
`promptOverride: true` is set.

Protected tools cannot be removed by overrides when they are present in the bundled Agent definition and listed in the
global protected-tool policy.

Final tool resolution:

```text
effective tools = merged override tools + protected bundled tools
```

Runtime `toolNames` can narrow the effective set but cannot add outside it. Runtime `customTools` can be supplied
explicitly by the host.

### 7.4 Models, Skills, and Tools

- Provider/model configuration maps Agents and tasks to appropriate models.
- Provider support should include OpenAI-compatible providers and local providers where practical.
- Skills are loaded from local project, home, bundled, and external-compatible directories.
- Slash-command skill invocation injects full Skill instructions only when needed.
- CLI tools remain preferred for many integrations.
- MCP remains optional rather than default context pollution.

### 7.5 Safety and Guardrails

- Execution must respect project/worktree boundaries.
- Dangerous shell actions need guardrails.
- Workflow Validation should prove implementation work before marking Plans verified.
- Worktree isolation should remain available for separating agent execution from the primary checkout.
- Governance should be optional and configurable, not a default blocker for small teams.

## 8. Technical Stack

- **Core runtime:** Deno CLI/TUI codebase.
- **Language:** pure JavaScript with JSDoc types.
- **Local UI:** Fresh/Vite/Preact Workspace app where applicable.
- **Core persistence:** repo-local markdown artifacts plus local RunWield state under `~/.wld/`.
- **Memory:** Mnemosyne for project/global agent memory.
- **Code intelligence:** local search/indexing tools such as Cymbal and structural search.
- **Collaboration:** local-first Plan Workspace and future remote Shared Spaces.
- **External integration:** Session Host and ACP as the strategic boundary.
- **Versioning and recovery:** execution baselines, worktree isolation, validation, and recovery flows.

## 9. Product Non-Goals

- Do not frame RunWield as agent fleet management.
- Do not lead with hosted execution as the first SaaS wedge.
- Do not compete through issue-tracker, ticket, Scrum, or Agile vocabulary.
- Do not persist raw chat traces as team planning memory by default.
- Do not make Git, GitHub, pull requests, or any external tracker mandatory artifact schema concepts.
- Do not make RunWield Workspace dependent on job-title-specific roles.

## 10. Success Metrics

Core metrics:

- speed to first useful Plan
- percentage of planned work reaching verification
- percentage of verified planned work producing Work Records
- quality of recovered context when resuming Plans
- reduction in repeated planning questions caused by missing history

Workspace metrics:

- Plan review cycle time
- number of active teams using Plans as the main planning object
- percentage of new Plans using retrieved Work Records, PRDs, or ADRs
- cross-project retrieval usefulness as rated by users
- Work Record edit/override rate after Recorder generation
- team retention driven by planning memory and collaboration value
