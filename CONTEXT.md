# RunWield Context

RunWield is an opinionated, plan-by-default coding harness that routes development requests through triage, planning,
review, execution, and validation. This context defines the project language used by agents, docs, plans, and code.

## Language

### Harness

**RunWield**: The plan-by-default coding harness that routes user requests through triage and specialized agents.
_Avoid_: Harness, tool, framework

**External Agent Host**: A coding-agent product such as Claude Code, Codex, OpenCode, or Pi that owns the user
conversation and model access for an Attached Workflow. _Avoid_: Provider, Session Host, host harness

**Attached Mode**: A RunWield installation mode in which an External Agent Host makes every model call and users invoke
RunWield explicitly for individual User Requests. _Avoid_: Plugin mode, always-on RunWield, trial mode

**Attached Workflow**: The per-request RunWield workflow active inside an External Agent Host, with RunWield governing
durable workflow truth while the host performs agent reasoning and execution. _Avoid_: Attached Mode, Managed Mode,
RunWield Session

**TUI**: The terminal-based interactive user interface that hosts agent conversations and renders workflow output.
_Avoid_: Shell, console

**Headless Mode**: The non-interactive RunWield execution surface that emits machine-readable Agent Session events for
external hosts. _Avoid_: TUI mode, batch wrapper, remote UI

**Agent Client Protocol (ACP)**: The editor-oriented JSON-RPC protocol RunWield implements for IDEs and external hosts.
_Avoid_: Agent Control Protocol, Agent Communication Protocol

**Session Host**: The non-TUI runtime boundary that owns one or more live RunWield Sessions and exposes them to external
clients. _Avoid_: TUI backend, daemon, adapter

**Session**: A durable user-facing conversation and workflow thread within one Project. A Session has its own history
and Session Name, persists across Agent handoffs, and may contain multiple Agent Sessions. _Avoid_: Agent Session,
HostedSession, Task, Work Item

**Session Transcript**: The private raw message and event history of one Session. Its owner may resume or search it, but
it is not shared project knowledge or a source for cross-Session Agent retrieval. _Avoid_: Work Record, planning memory,
shared conversation

**Session Transcript Segment**: An ordered durable portion of a Session Transcript that supplies one isolated
model-history context while remaining part of the Session's continuous user-visible history. _Avoid_: Sub-session, new
Session, Agent Session, JSONL file

**Session Control**: The right of one attached client to submit user messages or answer pending interactions for a live
Session; observation does not require control. _Avoid_: Plan Workflow Lease, Session ownership, Agent ownership

**Terminal Title**: The terminal emulator window or tab label RunWield sets for an interactive TUI session. _Avoid_: Tab
name, shell title

**Session Name**: The persisted short human label for a Session, initially derived from Router Triage for fresh User
Requests. _Avoid_: Tab title, conversation name

**Empty Project Directory**: A current working directory with no meaningful project files for RunWield to inspect.
_Avoid_: Empty Workspace, new project, initialized project

**User Request**: A natural-language request submitted by the user for triage and execution. _Avoid_: Prompt, input,
query

### Triage & Classification

**Triage**: Structured classification of a User Request by workflow type and complexity, usually performed by the
Router.

**Triage Report**: The structured output of Triage containing routing intent, complexity, summary, affected paths, and
an optional auto-generated Session Name. _Avoid_: Triage result, classification result

**Diagnostic Triage**: Read-only Triage for user-reported broken behavior that gathers enough evidence to estimate
likely blast radius without reproducing, instrumenting, or fixing the issue. _Avoid_: Diagnosis, debugging,
mini-debugger

**Routing Intent**: The Triage field selecting the workflow and Agent: `INQUIRY`, `IDEATION`, `OPERATION`, `QUICK_FIX`,
`PLANNED_CHANGE`, or `PROJECT`; legacy `FEATURE` normalizes to `PLANNED_CHANGE`. _Avoid_: Classification, route type,
request kind, category

**INQUIRY**: The fallback Routing Intent for non-materializing understanding work such as questions about repository
state, architecture, Plans, history, trade-offs, or casual discussion. _Avoid_: Question, investigation, research task

**IDEATION**: A Routing Intent for non-materializing product exploration where the user wants Socratic interviewing,
assumption stress-testing, current research, or PRD synthesis. _Avoid_: Inquiry, general help, planning workflow

**OPERATION**: A Routing Intent for direct repository or environment operations that do not require code implementation.
_Avoid_: QUICK_FIX, feature, coding task

**QUICK_FIX**: A Routing Intent for a bounded code implementation with no planning phase and no Plan file. _Avoid_:
Operational, hotfix, patch, feature

**PLANNED_CHANGE**: The Routing Intent and executable Plan Classification for material code work requiring a reviewed
Plan, independent of Work Kind. _Avoid_: FEATURE when referring to workflow, planned feature

**Work Kind**: The Plan Front Matter field describing requested work as `BUG_FIX`, `FEATURE`, `REFACTOR`, or
`MAINTENANCE`, independently from Plan Classification. _Avoid_: Routing Intent, Plan Classification

**BUG_FIX**: A Work Kind for correcting behavior that fails existing intended or specified behavior. _Avoid_: QUICK_FIX,
PLANNED_CHANGE

**FEATURE Work Kind**: A Work Kind for adding or enhancing functionality. _Avoid_: PLANNED_CHANGE, planned work

**Legacy FEATURE Classification**: The old Routing Intent and Plan Classification value that means PLANNED_CHANGE rather
than necessarily new functionality. _Avoid_: Enhancement, new feature

**PROJECT**: The Routing Intent and non-executable Epic Plan Classification for work the Architect designs and the
Slicer decomposes into child PLANNED_CHANGE Plans. _Avoid_: Initiative, refactor, task DAG

**Complexity**: A `LOW`, `MEDIUM`, or `HIGH` rating assigned during Triage. _Avoid_: Difficulty, effort, severity

**Affected Paths**: The ordered set of files identified during Triage as the likely vertical slice for a User Request.

**Vertical Slice**: A narrow, end-to-end trace through the codebase from entry point to boundary for one request.
_Avoid_: Cross-section, code path

### External Work Sources

**External Work Source**: A non-RunWield system that owns demand management for requested work. _Avoid_: RunWield
tracker, Plan store, execution system

**Ticket**: A demand-management item in an External Work Source that may relate to zero or more Plans without
participating in Plan Lifecycle. _Avoid_: Plan, User Request, Task

**Ticket Reference**: A structured relation on a Plan or Work Record whose required URL links to a related Ticket
without synchronizing content, state, or lifecycle. _Avoid_: Ticket copy, status mapping, external Plan

### Forge Delivery

**Forge**: A repository collaboration system such as GitHub or GitLab that governs branch publication, code review,
repository policy, and remote merge outcomes. _Avoid_: External Work Source, Ticket system, RunWield lifecycle owner

**Forge Change Request**: A provider-owned proposal to merge a published branch into a target branch, called a pull
request by GitHub and a merge request by GitLab. _Avoid_: FEATURE, Plan, Ticket, change request

**Repository Participation Declaration**: An upstream-authored, version-controlled policy that explicitly permits
contributed RunWield artifacts. _Avoid_: RunWield installation detection, inferred consent, contributor preference

**Publication Candidate**: The exact locally validated revision RunWield intends to publish through a Forge Change
Request. _Avoid_: Execution worktree, unvalidated branch, implementation draft

**Change Request Finalization**: The post-merge RunWield action that proves Forge delivery and records terminal Plan and
Work Record evidence in the canonical repository. _Avoid_: Forge merge, contributor synchronization, local-only status

**Direct Delivery**: The default delivery mode that merges validated implementation and verified Plan metadata into the
local target branch without a Forge Change Request. _Avoid_: Local review, unreviewed delivery

**Change Request Delivery**: An explicitly selected delivery mode that verifies the canonical Plan only after a proven
Forge merge of the validated Publication Candidate. _Avoid_: PR mode, remote merge-back, Direct Delivery

**Dual Review**: A Change Request Delivery policy that requires both RunWield's local human code review and review on
the Forge Change Request. _Avoid_: Semantic Agent Review, duplicate review

### Plans & Review

**Plan**: A markdown file in `plans/` with YAML Front Matter that describes the implementation strategy for a User
Request. _Avoid_: Blueprint, spec, design doc

**Work Record**: A small repo-local markdown retrospective planning-memory artifact that distills what completed planned
work actually produced and what future planning should remember. _Avoid_: Review log, chat transcript, implementation
diary, duplicate Plan

**Draft Work Record**: An external, manual, or imported Work Record awaiting human review before default search and
Agent retrieval. _Avoid_: Approved record, generated internal record, memory

**Pending Verification Work Record**: An internal Work Record generated before a terminal Plan outcome and excluded from
default search or Agent retrieval until then. _Avoid_: Draft Work Record, approved record, review guide

**Superseded Work Record**: A Work Record whose planning guidance has been replaced by a newer Work Record. _Avoid_:
Archived record, deleted record, draft record

**Archived Work Record**: A Work Record hidden from default human search and Agent retrieval while remaining available
by explicit request. _Avoid_: Superseded record, deleted record, draft record

**External Work Record**: A Work Record imported or manually created for work performed outside RunWield or recovered
after the original Plan was lost. _Avoid_: Draft record, ad hoc note, memory

**Work Record Provenance**: Source evidence for a Work Record, including source Plans when available and stable
file-level code evidence when constructed from existing code. _Avoid_: Line references, raw diff log, chat evidence

**Front Matter**: YAML metadata at the top of a Plan containing classification, complexity, status, timestamps, and
origin. _Avoid_: Metadata, header, YAML block

**Plan Classification**: The Plan Front Matter workflow shape, limited to `PLANNED_CHANGE` and `PROJECT`; legacy
`FEATURE` means `PLANNED_CHANGE`. _Avoid_: Routing intent, request type, work kind

**Plan Status**: The lifecycle state of a Plan: `draft`, `feedback`, `approved`, `ready_for_decomposition`,
`ready_for_work`, `in_progress`, `failed`, `implemented`, `verified`, `closed_without_verification`, or `on_hold`.
_Avoid_: Phase, stage

**Plan Lifecycle**: The state machine that decides how Plan Events change Plan Status and recovery metadata; see
`docs/plan-lifecycle.md`. _Avoid_: Status helper, plan status logic

**Plan Event**: A recorded workflow fact that the Plan Lifecycle uses to transition a Plan. _Avoid_: Next step, status
update

**Plan Workflow Lease**: A durable claim permitting exactly one Session at a time to drive consequential Plan workflow
actions; uncertain ownership requires explicit recovery or takeover. _Avoid_: Shared Plan Lock, worktree registry lock,
mutex

**Approved Plan**: A Plan whose Review Loop ended in user approval but whose pre-execution preparation may still be
unfinished. _Avoid_: Ready plan, executable plan

**Approve & Run**: A Plan review outcome that both approves the Plan and explicitly authorizes the current Session to
continue through readiness, execution, and Workflow Validation. _Avoid_: Approve, auto-run

**Approve for Later**: A Plan review outcome that approves and prepares the Plan as Ready For Work without authorizing
immediate execution. _Avoid_: Save draft, approve and run

**Ready For Work**: The Plan Status meaning execution prerequisites are satisfied; PLANNED_CHANGE Plans are executable,
while Epics expose their finalized child Plans but remain non-executable. _Avoid_: Approved, runnable

**Readiness Gate**: The classification-aware lifecycle step after approval that promotes PLANNED_CHANGE Plans to Ready
For Work and PROJECT Epics to Ready For Decomposition. _Avoid_: Slicer phase, execution check

**Failed Plan**: A Plan that reached Ready For Work but could not complete execution successfully. _Avoid_: Rejected
plan, invalid plan

**In-Progress Plan**: A Plan whose execution has started and whose worktree may contain partial implementation work.
_Avoid_: Running plan, active plan

**On-Hold Plan**: A deferred non-verified Plan that preserves its prior Plan Status and staleness baseline for a future
Resume Check. _Avoid_: Archived plan, canceled plan, completed plan

**Resume Check**: The pre-resume inspection for an On-Hold Plan that checks staleness and worktree risk before restoring
the held Plan Status. _Avoid_: Workflow Validation, plan validation, verify-and-resume

**Plan Recovery**: Choosing how to continue an In-Progress Plan or Failed Plan from the current worktree state. _Avoid_:
Resume, restart

**Failure Detail**: A durable explanation of why a Failed Plan could not complete work. _Avoid_: Error log, crash dump

**Implemented Plan**: A Plan whose execution work finished but whose Workflow Validation has not yet passed. _Avoid_:
Completed plan, done plan

**Verified Plan**: A Plan whose execution and Workflow Validation both finished successfully. _Avoid_: Completed plan,
done plan

**Closed Without Verification Plan**: A terminal Plan accepted without successful RunWield Workflow Validation. _Avoid_:
Verified plan, archived plan, on-hold plan

**Review Loop**: The cycle where a planning agent writes or revises a Plan and the user approves or returns it through
Plannotator. _Avoid_: Feedback loop, approval cycle

**Semantic Code Review**: The Reviewer check during Workflow Validation that compares implementation against the
approved Plan. _Avoid_: Local Human Code Review, Forge review, automated tests

**Local Human Code Review**: The optional RunWield gate where a person reviews the implementation diff before delivery.
_Avoid_: Semantic Code Review, Forge review, Plan Review Loop

**Review Issue Ledger**: The temporary per-attempt record of requirement coverage, Review Issues, repair claims, and
Reviewer re-verification. _Avoid_: Review log, durable Plan history, Work Record

**Review Issue**: A blocking Semantic Code Review finding that shows the implementation fails an unambiguous approved
Plan requirement and must be repaired before approval. _Avoid_: Review Advisory, style note, suggestion

**Review Advisory**: A non-blocking Semantic Code Review finding that explains an ambiguity in the approved Plan without
preventing implementation approval. _Avoid_: Review Issue, warning, waived defect

**PRD**: An independent durable product-requirements artifact that may inform multiple Plans and Agent Sessions without
participating in Plan Lifecycle. _Avoid_: Plan, Work Item, chat transcript

**Plannotator**: The browser-based artifact review UI where users approve, return feedback, or annotate Plans, Work
Records, and code-review diffs. _Avoid_: Plan-only review UI, approval screen

**Guided Review**: A Plannotator explanation of a PR or local diff presented in conceptual order with supporting prose
and visual aids. _Avoid_: Guide, review summary, file-order review

**Guided Review Policy**: The validation-time setting that decides whether RunWield never, conditionally, or always
generates a Guided Review for a human code review. _Avoid_: Diff size setting, guide preference

**Guided Review Widget**: A sandboxed interactive visual aid used when prose, diagrams, and live diffs cannot adequately
explain a Guided Review. _Avoid_: Default review block, arbitrary app extension, generated production UI

**Plan Board**: A browser surface for inspecting and editing Plans while repository Plan files remain canonical.
_Avoid_: Remote plan database, hosted board, task board

**Workspace**: The browser environment for RunWield Sessions, workflows, and durable artifacts across registered
Projects while repository artifacts remain canonical. _Avoid_: Project root, browser IDE, database-only knowledge base,
replacement for Plans

**Project**: A trusted repository or directory registered in Workspace as a boundary for Sessions, artifacts, code, and
workflows, distinct from the uppercase `PROJECT` Routing Intent. _Avoid_: Workspace, workspace root, project space

**Attention Dashboard**: The Workspace surface aggregating work needing user judgment and active or recent workflow
state across Projects. _Avoid_: Project grid, task board, notifications page

**Code Surface**: The Workspace surface for inspecting or manually changing a Project's main checkout. _Avoid_:
Workspace shell, Plan worktree editor, Agent terminal

**RunWield Design System**: The shared tokens, components, and interaction language governing RunWield browser surfaces.
_Avoid_: Workspace styles, style guide, UI kit

**Plan Card**: A Plan Board representation of a top-level Plan or Epic and its lifecycle state. _Avoid_: Task card,
ticket

**Plan Editor**: The Plan Board surface for editing Plan markdown while workflow-critical Front Matter remains governed
by structured Plan Lifecycle actions. _Avoid_: Raw Plan file editor, Front Matter editor

**Plan UI Server**: The local server that backs Plan Board access to Plan files in the current checkout. _Avoid_: Hosted
collaboration service, daemon

**Feedback**: Structured user annotations returned when a Plan is denied or re-opened in Plannotator. _Avoid_: Comments,
notes

**Revision**: A single planning pass that updates a Plan in response to Feedback.

**Resume**: Re-entering workflow for an existing Plan or session instead of starting from a fresh User Request. _Avoid_:
Continue, reopen, pick up

**Origin**: A Plan Front Matter value of `internal` for RunWield-created plans or `external` for imported markdown.
_Avoid_: Source, provenance

### Agents

**Agent**: A specialized LLM work owner and thinking mode with its own context boundary, Agent Definition, model
binding, and behavioral policy. _Avoid_: Bot, assistant, model, skill

**Router**: The default Agent Definition prompted to perform Triage and emit a Triage Report. _Avoid_: Dispatcher,
orchestrator, classifier, triager

**Operator**: The execution Agent for `OPERATION` work. _Avoid_: Executor, fixer, worker

**Planner**: The planning Agent for `FEATURE` work. _Avoid_: Designer, strategist

**Architect**: The planning Agent for `PROJECT` work. _Avoid_: Designer, lead

**Guide**: The read-mostly Agent for `INQUIRY` work that answers directly without materializing artifacts or running a
Socratic interview. _Avoid_: Explainer, investigator, researcher

**Ideator**: The strategic product and research Agent that conducts Socratic interviews to sharpen vague ideas before
planning or implementation. _Avoid_: General helper, explainer, guide

**Slicer**: The Agent that helps decompose an approved PROJECT Epic into child PLANNED_CHANGE Plans and can materialize
those plans under `plans/<epic-name>/`. _Avoid_: Task planner, splitter

**Recorder**: The Agent that generates Work Records from completed planned work. _Avoid_: Reviewer, summarizer, auditor

**Work Record Search Tool**: The tool for retrieving relevant Work Records with their status notices. _Avoid_: Memory
recall, plan search, Engineer context tool

**Project Knowledge Search**: Deliberate Agent retrieval over durable artifacts within the active Project. _Avoid_:
Session Transcript search, automatic context injection, code search

**Engineer**: The execution Agent that implements approved executable Plans and bounded no-plan QUICK_FIX code changes.
_Avoid_: Coder, implementer, developer

**Frontend Engineer**: The execution Agent for materially visual or interactive frontend implementation, with its own
browser-first and design-system-aware work policy. _Avoid_: Frontend mode, UI Engineer, Engineer with frontend Skill

**Tester**: The fresh-context verification Agent for behavioral QA, UI QA, PRD conformance testing, and adversarial
bug-finding. _Avoid_: Unit test writer, test framework specialist

**Agent Definition**: A markdown file with YAML Front Matter defining an Agent's display name, model, tools, and system
prompt. _Avoid_: Agent def, agent prompt, agent config

**Skill**: A reusable instruction package an Agent can load for a specialized technique without changing work owner or
Agent Session. _Avoid_: Agent, workflow role, sub-agent

**Testing Skill**: A bundled, language- and framework-agnostic Skill that guides an Agent in writing or maintaining
tests for a specific testing style or installed project stack. _Avoid_: Tester agent, QA role, bundled stack policy

**QA Intervention Policy**: A user or project preference that controls whether the Tester reports findings only, adds
regression tests, or fixes defects during verification. _Avoid_: Tester mode, QA setting

**Documentation Skill**: The Skill that guides an Agent when creating or updating project documentation. _Avoid_:
documentation agent, documenter

**Agent Name**: The internal identifier for an Agent, derived from its Agent Definition filename without `.md`. _Avoid_:
Display name, label

**Agent Display Name**: The human-readable name in Agent Definition Front Matter used when rendering agent messages.
_Avoid_: Agent name, file name

**Agent Session**: One invocation of an Agent with merged Agent Definition data, bound tools, extensions, and message
history. _Avoid_: Run, interaction, conversation

**Agent Handler**: The runtime handler that runs an active Agent Session turn and interprets workflow Custom Tool
outcomes. _Avoid_: Agent-specific handler, special agent handler

### Execution & Tools

**Workflow Orchestrator**: The runtime coordinator that consumes workflow Custom Tool outcomes and starts the next Agent
Session. _Avoid_: Router, dispatcher agent

**Workflow Decision**: An ephemeral semantic instruction telling workflow callers what to do next without directly
changing Plan Status. _Avoid_: Workflow Outcome, status update, lifecycle event

**Delegated Agent Session**: A disposable context-isolated Agent Session that receives a bounded brief from a parent
Agent Session and returns only its result. _Avoid_: Context-free session, Task worker, workflow handoff

**Epic**: A PROJECT Plan that contains design and decomposition context for child PLANNED_CHANGE Plans rather than
executable implementation work. _Avoid_: Initiative, umbrella task, PROJECT subtype

**Child PLANNED_CHANGE Plan**: An executable PLANNED_CHANGE Plan linked to an Epic through `parentPlan`. _Avoid_: Child
FEATURE Plan, subtask, ticket, DAG node

**Task Completion**: The `task_completed` signal an execution Agent emits when its assigned work is complete. _Avoid_:
Done message, final response

**Scope Escalation**: An execution-time discovery that active work is larger than the current Routing Intent and must
return to Router with context before continuing. _Avoid_: Surprise return, silent reroute

**Workflow Validation**: RunWield's independent validation pass after a completed executable Plan loop. _Avoid_: Agent
self-check, final summary

**Mechanical Validation**: RunWield's automated local validation command loop without semantic review or Plan status
transitions. _Avoid_: Workflow Validation, Reviewer review, agent self-check

**Pair Execution**: A user-steered frontend execution style where the Frontend Engineer delivers coherent visible
increments and blocks at intentional feedback checkpoints. _Avoid_: Live pair-design, frontend mode, Manual QA

**Toolset**: A named bundle of tool names granted to an Agent Session. _Avoid_: Tool list, capabilities

**Custom Tool**: A RunWield-defined tool registered alongside built-in pi tools. _Avoid_: Internal tool, RunWield tool

**Triage-Report Tool**: The `triage_report` Custom Tool that emits a Triage Report and ends the current Agent turn.
_Avoid_: Classification tool, triage result tool

**Plan-Written Tool**: The `plan_written` Custom Tool that starts the Review Loop and returns the Plan outcome. _Avoid_:
Review tool, approval tool

**Return-to-Router Tool**: The `return_to_router` Custom Tool that returns an out-of-scope conversation to Router with a
self-contained Triage prompt. _Avoid_: Handoff tool, switch-agent tool, agent router

**User-Interview Tool**: The `user_interview` Custom Tool for structured clarification questions. _Avoid_: Question
tool, clarification form

**Vision Fallback**: A configured vision-capable model used only when the active Agent model is text-only and needs a
textual description of an attached image. _Avoid_: Image mode, multimodal router, vision agent

**See-Image Tool**: The `see_image` Custom Tool that returns a Vision Fallback description of a retained image to a
text-only Agent. _Avoid_: Screenshot plugin, image reader, OCR tool

**Code-Batch Tool**: The Custom Tool that batches bounded Cymbal `show` and `outline` reads. _Avoid_: Multi-search tool,
smart project snapshot

### Memory & Persistence

**Mnemosyne**: The external semantic memory system for project and global memories. _Avoid_: Memory layer, memory store

**Memory**: A concise fact, decision, or preference stored in Mnemosyne for future retrieval. _Avoid_: Note, record,
entry

**Local Memory**: A project Memory retained only in its owner's local Mnemosyne collection. _Avoid_: Private memory,
personal memory

**Team Memory Candidate**: A Local Memory classified as stable, repository-safe, and useful to teammates but not yet
trusted as shared project context. _Avoid_: Shareable memory, pending memory

**Team Memory**: A project Memory whose canonical human-readable form is versioned in the repository and whose local
Mnemosyne copies are derived from trusted text. _Avoid_: Shared memory, synchronized memory

**Core Memory**: A Memory tagged `core` that is injected into every Agent Session independently of whether it is Local
or Team. _Avoid_: Critical memory, pinned memory, shared memory

**Global Memory**: A Memory stored in the cross-project collection. _Avoid_: Shared memory, universal memory

**Trusted Branch**: A configured repository branch whose reviewed Team Memories may become active local Mnemosyne
context. _Avoid_: Main branch, safe branch

**Sleep**: A maintenance workflow that exports, analyzes, and improves the Mnemosyne collection. _Avoid_: Memory
cleanup, memory maintenance

**Project Name**: The basename of the working directory used as the Mnemosyne collection identifier. _Avoid_:
Collection, namespace

**Cymbal**: The external code indexing and search system exposed to agents as codebase tools. _Avoid_: Search layer,
indexer

**Snip**: The external command-output compression proxy RunWield uses as an optional, fail-open runtime optimization for
eligible agent shell commands. _Avoid_: Required tool, agent tool, search tool

**Prompt Template**: A layered markdown template that defines a slash command available in the TUI. _Avoid_: Slash
command definition, prompt command

## Relationships

- One **Attached Workflow** governs one **User Request** inside one **External Agent Host**.
- During an **Attached Workflow**, the **External Agent Host** owns model calls while RunWield owns durable workflow
  truth, review, validation, recovery evidence, Work Records, and organizational memory.
- An **Attached Workflow** persists structured evidence and durable artifacts without copying the host conversation into
  a **Session Transcript**.
- A **Verified Plan** has the same meaning in Attached, Managed, and Native experiences.
- An **External Work Source** owns **Tickets** and demand management; RunWield owns planning, execution, **Plan
  Lifecycle**, and delivery truth.
- A **Forge** owns **Forge Change Requests**, repository review policy, branch publication, and remote merge outcomes.
- **Tickets** and **Plans** have a many-to-many relationship expressed through **Ticket References**.
- A **Ticket Reference** provides provenance and navigation without synchronizing either system's content, state, or
  lifecycle.
- A completed **Plan** carries its **Ticket References** into its **Work Record**; an Epic Work Record also aggregates
  Ticket References from its child Plans.
- A contributed Plan requires a **Repository Participation Declaration** before RunWield artifacts enter the
  **Publication Candidate**.
- Planned work uses either **Direct Delivery** or explicitly selected **Change Request Delivery**.
- **Change Request Delivery** can produce a **Verified Plan** only after a proven Forge merge of a revision covered by
  **Workflow Validation**.
- **Dual Review** adds **Local Human Code Review** to Forge review without replacing **Semantic Code Review**.
- One **User Request** produces exactly one **Triage Report**.
- A **Triage Report** contains one **Routing Intent**, one **Complexity**, one summary, and zero or more **Affected
  Paths**.
- **Affected Paths** identify existing project paths; an **Empty Project Directory** therefore produces none.
- **Diagnostic Triage** remains read-only and produces a normal **Routing Intent**.
- An **OPERATION** belongs to the **Operator** and creates no **Plan**.
- A **PLANNED_CHANGE** is planned by the **Planner**, reviewed through a **Review Loop**, and executed by the
  **Engineer** after approval.
- A **PROJECT** produces one **Epic**, which the **Slicer** decomposes into zero or more **Child PLANNED_CHANGE Plans**.
- **Work Kind** describes the nature of planned work independently from **Routing Intent** and **Plan Classification**.
- A **Plan** has exactly one **Plan Status**, one **Origin**, and one **Front Matter** block.
- A **Plan Event** is the only input that asks the **Plan Lifecycle** to change **Plan Status**.
- A **Plan Workflow Lease** permits exactly one **Session** at a time to drive consequential workflow actions for one
  Plan.
- **Plan Workflow Lease** ownership belongs to the Session and is distinct from client-level **Session Control**.
- An **Approved Plan** passes through the **Readiness Gate** before becoming **Ready For Work**.
- **Approve & Run** authorizes the current Session to continue after readiness; **Approve for Later** stops at Ready For
  Work until a separate Run action.
- Only a non-Epic Plan at **Ready For Work** can proceed to implementation.
- An **Epic** contains decomposition context; its **Child PLANNED_CHANGE Plans** are the independently executable units.
- An **Implemented Plan** must pass **Workflow Validation** before becoming a **Verified Plan**.
- An **In-Progress Plan** or **Failed Plan** may require **Plan Recovery** before workflow can continue safely.
- A **Verified Plan** or **Closed Without Verification Plan** may produce one **Work Record**.
- Every **Work Record** has **Work Record Provenance**.
- A **Draft Work Record** requires human approval before default Agent retrieval.
- A **Pending Verification Work Record** requires a terminal Plan outcome before default Agent retrieval.
- **Superseded Work Records** and **Archived Work Records** remain durable but are excluded from default planning
  retrieval.
- One implementation attempt has at most one temporary **Review Issue Ledger**.
- A **Review Issue** blocks Semantic Code Review approval; a **Review Advisory** does not.
- Denied Plan review produces **Feedback**, and each response to Feedback produces one **Revision**.
- A **PRD** may inform multiple Plans without participating in Plan Lifecycle.
- A **Workspace** contains zero or more registered **Projects** and may host live Sessions across them.
- A **Project** is the parent boundary for its Sessions, Plans, PRDs, ADRs, Work Records, and code access.
- A **Session** contains one user-facing history and one or more sequential or delegated **Agent Sessions**.
- A **Session Transcript** contains one or more ordered **Session Transcript Segments** while presenting one continuous
  user-visible history.
- A root Agent Session receives model history from only the active Session Transcript Segment.
- A live Session may have multiple observers but only one holder of **Session Control**.
- A Session Transcript is private to its owner and excluded from **Project Knowledge Search** and **Workspace
  Intelligence Search**.
- A fresh Session receives prior conclusions through explicitly referenced durable artifacts, not another Session's
  transcript.
- Starting from a PRD, Plan, or Work Record creates a fresh Session; **Resume** re-enters the existing Session.
- Once a Session produces a Plan, the Plan becomes its primary durable workflow anchor.
- **Approve & Run** activates a fresh execution Session Transcript Segment after readiness and preparation succeed;
  **Approve for Later** creates no execution segment.
- The execution segment receives the approved Plan, approval annotations, and execution state without inheriting
  planning messages.
- The Engineer remains the execution owner through Workflow Validation, repairs, recovery, and successful validation.
- **Project Knowledge Search** retrieves durable artifacts within one Project.
- The **RunWield Design System** governs **Workspace**, **Plan Board**, and **Plannotator** browser surfaces.
- Every **Agent Session** loads exactly one merged **Agent Definition**.
- An **Agent** may load one or more **Skills** without changing work ownership or Agent Session identity.
- A **Delegated Agent Session** receives a bounded brief without inheriting its parent's conversation history.
- An execution Agent Session emits **Task Completion** before validation can begin.
- **OPERATION** work ends after Operator self-verification; **QUICK_FIX** work receives **Mechanical Validation**;
  executable Plan work receives Workflow Validation.
- The **Frontend Engineer** owns materially visual or interactive frontend implementation; **Pair Execution** is an
  optional execution style, not a validation substitute.
- **Scope Escalation** returns work to the **Router** for fresh Triage.
- The **See-Image Tool** uses **Vision Fallback** only for a text-only active model.
- Every project **Memory** is either a **Local Memory** or a **Team Memory**; **Core Memory** independently controls
  always-on injection.
- A **Team Memory Candidate** begins as Local Memory and becomes Team Memory only after its canonical text is trusted
  through the repository workflow.
- A Team Memory has one canonical repository representation and zero or more derived local **Mnemosyne** copies.
- Only Team Memories accepted through a **Trusted Branch** may become active shared context.
- Core Memories are injected into every Agent Session.
