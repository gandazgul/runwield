# Product Requirements Document (PRD): RunWield

**Document role: Living central PRD.** Product vision, guiding principles, and the relationship between Core, Workspace,
and Connect.

Keep this document as current product guidance. Fold lasting requirements from completed feature PRDs here;
implementation steps belong in Plans, architectural choices in ADRs, and delivery evidence in Work Records.

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
- Sessions across TUI, browser, and ACP-compatible external clients
- Router, Ideator, Planner, Architect, Slicer, Engineer, Operator, Reviewer, Tester, and Recorder agents
- local Plans, PRDs, ADRs, and Work Records as markdown artifacts
- local execution, validation, and recovery workflows

Core remains useful by itself. It should provide the full local loop for one project/repository without requiring the
hosted product.

The detailed Core product requirements live in [runwield-core-prd.md](./runwield-core-prd.md). This root PRD summarizes
Core only enough to place it inside the broader RunWield product architecture.

### 2.2 RunWield Workspace

**RunWield Workspace** is the browser environment for working across Projects. Personal Workspace first serves one owner
moving between the TUI and their phone: starting, continuing, and returning to the same conversation must be ordinary
and reliable. Team collaboration and SaaS extend that experience later.

Workspace focuses on:

- Plan-centered collaboration
- shared backlog and in-progress planning flow
- collaborative Plan review
- assignable human code review with Agent assistance, replacing forge pull-request review by default
- PRD, ADR, and Work Record visibility
- cross-project planning memory
- relevant retrieval for new planning work
- optional governance around approvals and records

Workspace should not initially lead with hosted execution. Hosted AFK `wld` agents may become a later capability for
executing ready Plans, but the first SaaS wedge is collaborative planning and records.

The detailed Workspace product requirements live in [runwield-workspace-prd.md](./runwield-workspace-prd.md). That PRD
marries the local Plan management UI and encrypted collaborative planning directions into the self-hostable and hosted
Workspace story.

### 2.3 RunWield Connect

**RunWield Connect** is the plugin ecosystem that brings RunWield planning, verification, recovery, Work Records, and
memory into external agent hosts such as Claude Code, Codex, OpenCode, and Pi. It begins with first-party plugins built
and compatibility-tested by RunWield.

The external host remains the user's interface and makes every model call. RunWield Core supplies the durable workflow
authority and local operations on demand. A user explicitly activates Connect for an individual request; installing a
Connect plugin must not alter ordinary host behavior.

Connect is a first-class way to use RunWield, not a deliberately weakened trial of Core or Workspace. Its detailed
requirements live in [runwield-connect-prd.md](./runwield-connect-prd.md). That document retains **attached mode** and
**Attached Workflow** as internal architectural terms while using RunWield Connect as the public product name.

When RunWield Core owns the Session and invokes another harness non-interactively, such as Claude Code through
`claude -p` or Antigravity CLI, that harness is an **Execution Backend** alongside Pi. Execution Backends are Core
capabilities, not RunWield Connect plugins or separately branded product modes.

### 2.4 Naming

- **RunWield**: public product and umbrella brand.
- **RunWield Core**: free local harness.
- **RunWield Connect**: plugins for using RunWield workflows inside external agent hosts.
- **RunWield Workspace**: personal browser workspace, with team collaboration and SaaS later.
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
erase the repo-local Plan model. Optional external Ticket links preserve user-identified demand provenance for
navigation; RunWield still does not make external trackers mandatory, fetch Ticket data, or synchronize Ticket lifecycle
state.

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
- linked to source Plans and discoverable from the completed work
- searchable and retrievable by relevance for future planning
- compressible or reorganizable later without mutating source Plans

Work Records are not generated for no-plan `QUICK_FIX` work. Quick fixes are usually local, one-off, and too granular
for durable planning memory, and those changes are explained by their commit messages. Merges made outside RunWield's
Plan workflow likewise produce commits, not records — with one exception: a maintainer may explicitly record substantial
externally contributed work as an **external Work Record** that certifies provenance (the source change, the
contributor, the reviewing maintainer, and the validation that actually ran) rather than RunWield validation. External
records are opt-in, never automatic.

The guarantee runs one direction: every verified Plan produces a Work Record with delivery evidence, but no merge is
required to have a Plan or a Work Record. Work Records are a layer of memory over planned work, not the authoritative
history of the target branch — the git log owns commit-level history. RunWield is responsible for the provenance of its
own merges, with clear commits that point back to their Plans; each team owns its commit discipline for everything else.

## 5. RunWield Core Requirements

This section is a product-level summary. See [runwield-core-prd.md](./runwield-core-prd.md) for the fuller Core PRD that
preserves the detailed local harness, TUI, routing, lifecycle, tooling, and validation requirements.

### 5.1 Session Host and Clients

Users can create, reopen, continue, cancel, and follow multiple independent Sessions through the TUI, local browser UI,
and external ACP clients. Moving between screens preserves the same conversation, Agent, model, and workflow. Leaving an
idle screen open must not prevent the same owner from continuing elsewhere.

The local browser experience remains useful without SaaS. Runtime boundaries and coordination belong in
[ADR-010](../adr/010-session-runtime-sibling-adapters-and-acp.md) and
[ADR-015](../adr/015-file-authoritative-session-bundles.md).

### 5.2 Router and Agent Workflows

The Router is the default triage Agent in Core. It is a peer Agent, not a special system wrapper.

Routing intents:

- `INQUIRY`: read-mostly understanding work
- `IDEATION`: product/research exploration and Socratic shaping before planning
- `OPERATION`: direct non-code repository or environment operations
- `QUICK_FIX`: bounded code implementation with no Plan file
- `PLANNED_CHANGE`: planned executable work. Work Kind (`BUG_FIX`, `FEATURE`, `REFACTOR`, `MAINTENANCE`) separately
  records the nature of the work; legacy `FEATURE` routing and classification values normalize here.
- `PROJECT`: Epic-scale work that is decomposed into child Planned Change Plans

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

### 5.4 Triage and Plan Review

Router explains the request's classification and hands off to the appropriate specialist. Planner and Architect present
saved Plans for review, preserve feedback in the conversation, and distinguish approval for later from proceeding to
readiness and execution. Agent prose alone does not establish a completed workflow outcome.

### 5.5 Plan Lifecycle, Validation, and Recovery

Plan status communicates the work’s stage and the actions the user can take next.

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
- **Readiness Gate:** Planned Change Plans promote to `ready_for_work`; PROJECT Epics promote to
  `ready_for_decomposition`, then `ready_for_work` when Slicer finalizes child Plans.
- **Execution Gate:** executable Plans start only from `ready_for_work`.
- **Implementation Gate:** implementation being finished remains distinct from verification.
- **Workflow Validation Gate:** executable Planned Change and legacy non-Epic PROJECT work runs local validation and
  semantic review before reaching `verified`.

PROJECT Epics are containers, not directly executable implementation work. Child Planned Change Plans validate
independently. A user may mark an Epic done enough for now with an explanation, visibly distinguishing that outcome from
completing every child Plan.

Loading an `in_progress`, `failed`, or `implemented` Plan opens a recovery path. The user can inspect the scoped diff,
continue, reset to the captured execution baseline, re-open for review, or retry validation.

### 5.6 Work Record Generation

Recorder turns completed top-level planned work into concise, reusable records. An Epic record can summarize its child
outcomes and deferred scope. Generation is enabled by default, can be disabled, and is best effort: a failure leaves the
completed work intact and offers backfill.

Records distinguish RunWield verification, user-attested verification, closure without verification, and done-enough
completion. Search defaults to current approved records; historical or unapproved material carries clear notices.
Routine no-plan work remains explained by commits. External or manual records are explicit choices and must not claim
validation that did not run.

The [Core PRD](runwield-core-prd.md#work-records) owns detailed product behavior for generation, backfill, retrieval,
correction, and user-confirmed replacement. Workspace adds browser and cross-Project access; Connect uses the same
recording principles without importing external conversations.

## 6. RunWield Workspace Requirements

### 6.1 Primary Surface

Personal Workspace opens with the attention queue described in the [Workspace PRD](runwield-workspace-prd.md). The Plan
workspace remains the center for planned work; the team collaboration requirements below are later scope.

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
- Code-review discussion, assignment, and approval state are collaboration process data. Workspace hosts them outside
  the repository, as it does working conversations; only durable results — Plans, Work Records, and commits — enter the
  repo.
- Artifact metadata can store user and Agent authorship.
- Details screens can show quiet metadata such as author, drafting Agent, approval mode, and source references.
- Admin/debug session access may exist where policy allows.
- Product analytics should be anonymized and aggregated for RunWield improvement unless users explicitly opt into
  broader sharing.

### 6.3 Roles and Permissions

The later team Workspace should start with minimal roles:

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

```text
A trusted planning system where every material change has a reviewable intent, governed execution, independently verified outcome, and reusable record of what the team learned.
```

Workspace should extend Core's repo-local records with:

- team-wide Work Record search
- cross-project retrieval for new Plans
- context packs for Ideator, Planner, and Architect
- compression/deduplication of older records over time
- answers to "what did we decide before?" across projects
- filtering by project, area, Plan type, completion mode, and status

This is a key reason to pay for Workspace. It should strengthen planning without reframing RunWield as hosted agent
management.

### 6.6 Code Review and Merge

Under the default posture, Workspace replaces the forge pull-request loop for teams that adopt it:

- human code review happens in Workspace and can be assigned to a teammate, with Agents available to reviewer and author
  for context and changes;
- a Workspace merge component lands validated, approved work on the target branch only after shared CI is green;
- identity, audit, and person provenance are Workspace responsibilities, with GitHub identity and permission integration
  high on the roadmap;
- per repository, team, or instance, a team can instead keep forge-hosted review or run both review gates; the two gates
  never synchronize state;
- externally contributed work (for example, a drive-by pull request from someone without RunWield) becomes source
  material for a maintainer-owned Plan, preserving both author and maintainer provenance.

Local validation never replaces shared CI. Teams integrated with a forge keep a fast local validation tier and a fuller
shared CI tier, mirroring this repository's `deno task ci` versus `deno task release:check` separation.

## 7. Advanced Core Capabilities

### 7.1 Memory and Indexing

- **Mnemoteca Integration:** project/global persistent memory for user preferences, project facts, and critical context.
- **Memory Maintenance:** cleanup and organization flows through built-in commands.
- **Code Intelligence:** structural and semantic project search through local tooling.
- **Project Brief:** compressed project context injected where useful without flooding every prompt.

RunWield should distinguish Mnemoteca-style operational memory from Work Records. Mnemoteca stores recallable agent
memory; Work Records are durable planning artifacts owned by the project/team.

### 7.2 Agent Specialization

Bundled Agents include Router, Guide, Ideator, Operator, Planner, Architect, Slicer, Engineer, Tester, Reviewer, and
Recorder.

Users can customize Agents and load Skills, but customization should preserve protected workflow tools needed for Core
behavior.

### 7.3 Agent Tool Policy

Users can customize Agents at project or personal scope while retaining bundled defaults. Required workflow tools remain
available so customization does not disable planning and verification. The Core product document describes the
customization experience; loading and tool-resolution rules belong in technical documentation.

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

## 8. Delivery and References

Core delivers the useful local planning-to-record loop. Personal Workspace makes that work usable from a browser and
phone. Connect brings the same workflow to supported external agent hosts. Collaborative SaaS follows with shared
planning, review, and records; hosted execution is later scope.

The linked Core, Workspace, and Connect PRDs define their release outcomes. Architecture is recorded in [ADRs](../adr/);
implementation work is tracked in [Plans](../plans/).

### Living Product Requirements

These five PRDs own current product intent: RunWield summarizes the product, Core owns shared local behavior, Workspace
owns browser and collaboration journeys, Connect owns external-host use, and ACP owns external-client compatibility and
chat-channel integration. Feature PRDs explore unfinished proposals. After delivery, fold lasting requirements and
meaningful unresolved scope into the appropriate living PRD, update references, and remove the completed feature PRD.
Git history preserves its earlier text; Work Records preserve delivery evidence. Completion does not make historical
implementation restrictions current product policy.

## 9. Product Non-Goals

- Do not frame RunWield as agent fleet management.
- Do not lead with hosted execution as the first SaaS wedge.
- Do not compete through issue-tracker, ticket, Scrum, or Agile vocabulary.
- Do not persist raw chat traces as team planning memory by default.
- Do not make Git, GitHub, pull requests, or any external tracker mandatory artifact schema concepts.
- Do not make RunWield Workspace dependent on job-title-specific roles.
- Do not treat forge pull requests as the default human review loop; forge-hosted review is an opt-in per repository or
  team.
- Do not treat Work Records as the audit history of the target branch; the git log owns commit-level history.

## 10. Success Metrics

Core metrics:

- speed to first useful Plan
- percentage of planned work reaching verification
- percentage of verified planned work producing Work Records
- quality of recovered context when resuming Plans
- reduction in repeated planning questions caused by missing history

Workspace metrics:

- successful Session start and TUI → phone → TUI continuation with both screens left open
- user effort required to resume work remotely

- Plan review cycle time
- number of active teams using Plans as the main planning object
- percentage of new Plans using retrieved Work Records, PRDs, or ADRs
- cross-project retrieval usefulness as rated by users
- Work Record edit/override rate after Recorder generation
- team retention driven by planning memory and collaboration value

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
