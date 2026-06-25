# RunWield Context

RunWield is an opinionated, plan-by-default coding harness that routes development requests through triage, planning,
review, execution, and validation. This context defines the project language used by agents, docs, plans, and code.

## Language

### Harness

**RunWield**: The plan-by-default coding harness that routes user requests through triage and specialized agents.
_Avoid_: Harness, tool, framework

**TUI**: The terminal-based interactive user interface that hosts agent conversations and renders workflow output.
_Avoid_: Shell, console

**Terminal Title**: The terminal emulator window or tab label RunWield sets for an interactive TUI session. _Avoid_: Tab
name, shell title

**Session Name**: The persisted short human label for an Agent Session, initially derived from Router Triage for fresh
User Requests. _Avoid_: Tab title, conversation name

**User Request**: A natural-language request submitted by the user for triage and execution. _Avoid_: Prompt, input,
query

### Triage & Classification

**Triage**: Structured classification of a User Request by workflow type and complexity, usually performed by the
Router. _Avoid_: Assessment, evaluation, analysis

**Triage Report**: The structured output of Triage containing routing intent, complexity, summary, affected paths, and
an optional auto-generated Session Name. _Avoid_: Triage result, classification result

**Diagnostic Triage**: Read-only Triage for user-reported broken behavior that gathers enough evidence to estimate
likely blast radius without reproducing, instrumenting, or fixing the issue. _Avoid_: Diagnosis, debugging,
mini-debugger

**Routing Intent**: The top-level intent emitted by Triage that decides which Agent receives the User Request:
`INQUIRY`, `IDEATION`, `QUICK_FIX`, `FEATURE`, or `PROJECT`. _Avoid_: Classification, route type, request kind, category

**INQUIRY**: The fallback Routing Intent for non-materializing understanding work such as questions about repository
state, architecture, Plans, history, trade-offs, or casual discussion. _Avoid_: Question, investigation, research task

**IDEATION**: A Routing Intent for non-materializing product exploration where the user wants Socratic interviewing,
assumption stress-testing, current research, or PRD synthesis. _Avoid_: Inquiry, general help, planning workflow

**QUICK_FIX**: A Routing Intent for a small direct change with no planning phase and no Plan file. _Avoid_: Operational,
hotfix, patch, bug fix

**FEATURE**: A Routing Intent and Plan file type for new functionality that requires a reviewed implementation Plan.
_Avoid_: Enhancement, change request

**PROJECT**: A Routing Intent and Plan file type for Epic-scale work that is too large to execute directly. A PROJECT
Plan is an Epic container that the Architect designs and the Slicer decomposes into independently executable child
FEATURE Plans. _Avoid_: Initiative, refactor, task DAG

**Complexity**: A `LOW`, `MEDIUM`, or `HIGH` rating assigned during Triage. _Avoid_: Difficulty, effort, severity

**Affected Paths**: The ordered set of files identified during Triage as the likely vertical slice for a User Request.
_Avoid_: Impacted files, file list

**Vertical Slice**: A narrow, end-to-end trace through the codebase from entry point to boundary for one request.
_Avoid_: Cross-section, code path

### Plans & Review

**Plan**: A markdown file in `plans/` with YAML Front Matter that describes the implementation strategy for a User
Request. _Avoid_: Blueprint, spec, design doc

**Front Matter**: YAML metadata at the top of a Plan containing classification, complexity, status, timestamps, and
origin. _Avoid_: Metadata, header, YAML block

**Plan Classification**: The `classification` Front Matter field for Plan files, limited to Plan-producing work such as
`FEATURE` and `PROJECT`. _Avoid_: Routing intent, request type, route category

**Plan Status**: The lifecycle state of a Plan: `draft`, `feedback`, `approved`, `ready_for_decomposition`,
`ready_for_work`, `in_progress`, `failed`, `implemented`, `verified`, `closed_without_verification`, or `on_hold`.
_Avoid_: Phase, stage

**Plan Lifecycle**: The state machine that decides how Plan Events change Plan Status and recovery metadata; see
`docs/plan-lifecycle.md`. _Avoid_: Status helper, plan status logic

**Plan Event**: A recorded workflow fact that the Plan Lifecycle uses to transition a Plan. _Avoid_: Next step, status
update

**Approved Plan**: A Plan whose Review Loop ended in user approval but whose pre-execution preparation may still be
unfinished. _Avoid_: Ready plan, executable plan

**Ready For Work**: The only executable Plan Status for FEATURE Plans and legacy non-Epic PROJECT Plans, meaning the
Plan is approved and every pre-execution prerequisite is satisfied. For an Epic, Ready For Work means decomposition is
finalized and child FEATURE Plans can be selected; the Epic itself is still not executed directly. _Avoid_: Approved,
runnable

**Readiness Gate**: The classification-aware lifecycle step after approval. It promotes FEATURE Plans to Ready For Work,
promotes Epic PROJECT Plans to Ready For Decomposition, and keeps legacy non-Epic PROJECT task-table preparation
separate. _Avoid_: Slicer phase, execution check

**Failed Plan**: A Plan that reached Ready For Work but could not complete execution successfully. _Avoid_: Rejected
plan, invalid plan

**In-Progress Plan**: A Plan whose execution has started and whose worktree may contain partial implementation work.
_Avoid_: Running plan, active plan

**On-Hold Plan**: A non-verified Plan intentionally deferred because priorities changed or the user changed their mind
for now, suppressed from normal active-work prompts while preserving the prior Plan Status and pre-hold staleness
baseline needed to resume through a Resume Check. _Avoid_: Archived plan, canceled plan, completed plan

**Resume Check**: The pre-resume inspection for an On-Hold Plan that checks staleness and worktree risk before restoring
the held Plan Status. _Avoid_: Workflow Validation, plan validation, verify-and-resume

**Plan Recovery**: Choosing how to continue an In-Progress Plan or Failed Plan from the current worktree state. _Avoid_:
Resume, restart

**Failure Detail**: A durable explanation of why a Failed Plan could not complete work. _Avoid_: Error log, crash dump

**Implemented Plan**: A Plan whose execution work finished but whose Workflow Validation has not yet passed. _Avoid_:
Completed plan, done plan

**Verified Plan**: A Plan whose execution and Workflow Validation both finished successfully. _Avoid_: Completed plan,
done plan

**Closed Without Verification Plan**: A terminal Plan whose work is no longer active because the user manually accepted,
verified outside RunWield, or chose not to require Workflow Validation. _Avoid_: Verified plan, archived plan, on-hold
plan

**Review Loop**: The cycle where a planning agent writes or revises a Plan and the user approves or returns it through
Plannotator. _Avoid_: Feedback loop, approval cycle

**Plannotator**: The browser-based review UI where users approve, save, deny, or annotate a Plan. _Avoid_: Review UI,
approval screen

**Plan Board**: A browser-based local UI over the current checkout's `plans/` directory that displays Plans by Plan
Status and lets the user inspect or edit Plan files while preserving the local Plan files as the canonical source of
truth. _Avoid_: Remote plan database, hosted board, task board

**Workspace**: A future browser-based RunWield space that can contain Plans alongside project documentation, notes,
wiki-style pages, and other project knowledge while preserving Plans as markdown files that workflow agents can read.
_Avoid_: Database-only knowledge base, replacement for Plans

**Plan Card**: A Plan Board representation of a top-level Plan. Epic Plan Cards summarize child FEATURE Plan progress
and open an Epic detail view rather than flattening every child FEATURE Plan onto the main board by default. _Avoid_:
Task card, ticket

**Plan Editor**: The Plan Board editing surface for a Plan's markdown body. Workflow-critical Front Matter changes are
made through structured controls or Plan Lifecycle actions, not by default raw YAML editing. _Avoid_: Raw Plan file
editor, Front Matter editor

**Plan UI Server**: An ephemeral local web server started by RunWield, for example through `wld plans ui`, that serves
the Plan Board and reads or writes Plan files in the current checkout. _Avoid_: Hosted collaboration service, daemon

**Feedback**: Structured user annotations returned when a Plan is denied or re-opened in Plannotator. _Avoid_: Comments,
notes

**Revision**: A single planning pass that updates a Plan in response to Feedback. _Avoid_: Iteration, amendment

**Resume**: Re-entering workflow for an existing Plan or session instead of starting from a fresh User Request. _Avoid_:
Continue, reopen, pick up

**Origin**: A Plan Front Matter value of `internal` for RunWield-created plans or `external` for imported markdown.
_Avoid_: Source, provenance

### Agents

**Agent**: A specialized LLM work owner and thinking mode with its own context boundary, Agent Definition, model
binding, and behavioral policy. _Avoid_: Bot, assistant, model, skill

**Router**: The default Agent Definition prompted to perform Triage and emit a Triage Report. _Avoid_: Dispatcher,
orchestrator, classifier, triager

**Operator**: The execution Agent for `QUICK_FIX` work. _Avoid_: Executor, fixer, worker

**Planner**: The planning Agent for `FEATURE` work. _Avoid_: Designer, strategist

**Architect**: The planning Agent for `PROJECT` work. _Avoid_: Designer, lead

**Guide**: The read-mostly Agent for `INQUIRY` work that answers questions directly and discusses ideas without
materializing Plans, code, or documentation or running a Socratic interview. _Avoid_: Explainer, investigator,
researcher

**Ideator**: The strategic product and research Agent that conducts Socratic interviews to sharpen vague ideas before
planning or implementation. _Avoid_: General helper, explainer, guide

**Slicer**: The Agent that helps decompose an approved PROJECT Epic into child FEATURE Plans and can materialize those
plans under `plans/<epic-name>/`. _Avoid_: Task planner, splitter

**Engineer**: The execution Agent that implements approved executable Plans. _Avoid_: Coder, implementer, developer

**Tester**: The fresh-context verification Agent for behavioral QA, UI QA, PRD conformance testing, and adversarial
bug-finding. _Avoid_: Unit test writer, test framework specialist

**Agent Definition**: A markdown file with YAML Front Matter defining an Agent's display name, model, tools, and system
prompt. _Avoid_: Agent def, agent prompt, agent config

**Skill**: A reusable instruction package an Agent can load for a specialized technique without changing work owner or
Agent Session. _Avoid_: Agent, workflow role, sub-agent

**Testing Skill**: A Skill that guides an implementation Agent in writing or maintaining tests in a specific testing
style or framework. _Avoid_: Tester agent, QA role

**Documentation Skill**: The Skill that guides an Agent when creating or updating project documentation. _Avoid_:
documentation agent, documenter

**Agent Name**: The internal identifier for an Agent, derived from its Agent Definition filename without `.md`. _Avoid_:
Display name, label

**Agent Display Name**: The human-readable name in Agent Definition Front Matter used when rendering agent messages.
_Avoid_: Agent name, file name

**Agent Session**: One invocation of an Agent with merged Agent Definition data, bound tools, extensions, and message
history. _Avoid_: Run, interaction, conversation

**Agent Handler**: The runtime handler for the active Agent that runs one Agent Session turn, applies any explicit Agent
Definition or workflow-scoped Custom Tools, and interprets workflow Custom Tool outcomes. _Avoid_: Agent-specific
handler, special agent handler

### Execution & Tools

**Workflow Orchestrator**: The runtime coordinator that consumes workflow Custom Tool outcomes and starts the next Agent
Session. _Avoid_: Router, dispatcher agent

**Workflow Decision**: An ephemeral runtime instruction with `kind` and `payload` fields that tells workflow callers
what to do next after interpreting tool outcomes, Agent Session results, or Plan Status; it does not change Plan Status
directly and carries semantic reason codes rather than user-facing text. _Avoid_: Workflow Outcome, status update,
lifecycle event

**Epic**: The accepted domain subtype for a PROJECT Plan with `type: epic`. An Epic is a container for design context
and child FEATURE Plans; it is not an executable implementation Plan. _Avoid_: Initiative, umbrella task

**Child FEATURE Plan**: A FEATURE Plan with a `parentPlan` pointer to an Epic. It follows the normal FEATURE lifecycle
and is the executable unit produced by decomposition. _Avoid_: Subtask, ticket, DAG node

**Task**: A legacy numbered unit of work inside an older non-Epic PROJECT task table, with an assignee and dependency
list. Current PROJECT Epics decompose into child FEATURE Plans instead. _Avoid_: Step, child FEATURE, work item

**Assignee**: The Agent role designated to execute a legacy Task. _Avoid_: Owner, handler, responsible

**Task Dispatch**: Legacy execution of non-Epic PROJECT Tasks in dependency order by routing each Task to its Assignee.
Current PROJECT Epics do not use Task Dispatch. _Avoid_: Decomposition, child FEATURE execution

**Task Completion**: The `task_completed` signal an execution Agent emits when its assigned work is complete. _Avoid_:
Done message, final response

**Scope Escalation**: An execution-time discovery that a `QUICK_FIX` likely needs FEATURE or PROJECT workflow before
continuing. _Avoid_: Surprise return, silent reroute

**Integration Point**: The final tester-owned Task in a legacy non-Epic PROJECT Task graph that depends on every prior
Task and checks cross-slice integration before Workflow Validation. _Avoid_: Final verification task, cross-slice
verification task, acceptance gate

**Workflow Validation**: RunWield' independent validation pass after a completed workflow loop. _Avoid_: Agent
self-check, final summary

**Toolset**: A named bundle of tool names granted to an Agent Session. _Avoid_: Tool list, capabilities

**Custom Tool**: A RunWield-defined tool registered alongside built-in pi tools. _Avoid_: Internal tool, RunWield tool

**Triage-Report Tool**: The `triage_report` Custom Tool that emits a Triage Report and ends the current Agent turn.
_Avoid_: Classification tool, triage result tool

**Plan-Written Tool**: The `plan_written` Custom Tool that starts the Review Loop and returns the Plan outcome. _Avoid_:
Review tool, approval tool

**Return-to-Router Tool**: The `return_to_router` Custom Tool that lets a user-facing Agent hand an out-of-scope
interactive conversation back to Router with a self-contained Triage prompt. _Avoid_: Handoff tool, switch-agent tool,
agent router

**User-Interview Tool**: The `user_interview` Custom Tool for structured clarification questions. _Avoid_: Question
tool, clarification form

**Vision Fallback**: A configured vision-capable model used only when the active Agent model is text-only and needs a
textual description of an attached image. _Avoid_: Image mode, multimodal router, vision agent

**See-Image Tool**: The `see_image` Custom Tool that sends a retained image attachment to the Vision Fallback and
returns a textual description to a text-only Agent model. _Avoid_: Screenshot plugin, image reader, OCR tool

### Memory & Persistence

**Mnemosyne**: The external semantic memory system for project and global memories. _Avoid_: Memory layer, memory store

**Memory**: A concise fact, decision, or preference stored in Mnemosyne for future retrieval. _Avoid_: Note, record,
entry

**Core Memory**: A Memory tagged `core` that is injected into every Agent Session. _Avoid_: Critical memory, pinned
memory

**Global Memory**: A Memory stored in the cross-project collection. _Avoid_: Shared memory, universal memory

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

- A **TUI** session may set a **Terminal Title** before and after **Triage** to keep terminal tabs distinguishable.
- A **Terminal Title** should mirror the current **Session Name** when one exists.
- Router-provided auto-naming only sets the **Session Name** for unnamed sessions; manual naming overrides it.
- A **User Request** is classified by an Agent emitting exactly one **Triage Report** through the **Triage-Report
  Tool**.
- The **Router** is the default Agent used for fresh Triage, but the **Workflow Orchestrator** reacts to the
  **Triage-Report Tool** outcome rather than to the **Router** Agent Name.
- A **Triage Report** contains exactly one **Routing Intent**, one **Complexity**, one summary, and zero or more
  **Affected Paths**.
- **Diagnostic Triage** is a read-only specialization of **Triage** used for unknown-cause broken behavior; it still
  emits a normal **Routing Intent** rather than a bug-specific intent.
- A **QUICK_FIX** is executed directly by the **Operator** and creates no **Plan**.
- A **FEATURE** is planned by the **Planner**, reviewed through one **Review Loop**, and executed by the **Engineer**
  after approval.
- A **PROJECT** is planned by the **Architect** as an **Epic**, decomposed by the **Slicer** into one or more **Child
  FEATURE Plans**, and executed by loading those child FEATURE Plans independently.
- A **Plan** has exactly one **Plan Status**, exactly one **Origin**, and one **Front Matter** block.
- A **Plan Event** is the only way workflow code should ask the **Plan Lifecycle** to change Plan Status.
- An **Approved Plan** passes through the **Readiness Gate** before becoming **Ready For Work**.
- A **Plan** can proceed to direct implementation only when its **Plan Status** is **Ready For Work** and it is not an
  **Epic** container.
- A **Failed Plan** must have reached **Ready For Work** before work failed.
- An **In-Progress Plan** requires recovery because execution may have partially changed the worktree.
- **Plan Recovery** resolves whether RunWield continues the current worktree state, reports on it, re-opens the Plan, or
  returns the worktree to a known pre-execution state.
- A **Failed Plan** should include **Failure Detail** when RunWield can identify the cause.
- An **Implemented Plan** still requires **Workflow Validation**.
- An **Implemented Plan** may include **Failure Detail** when Workflow Validation fails.
- A **Verified Plan** must have passed **Workflow Validation**.
- A denied **Plan** produces **Feedback**, and each **Feedback** response triggers one **Revision**.
- An **Epic** has zero or more **Child FEATURE Plans** discovered by their `parentPlan` Front Matter pointer.
- A **Child FEATURE Plan** follows the normal FEATURE lifecycle and may list sibling FEATURE dependencies.
- An **On-Hold Plan** can be an **Epic**; its **Child FEATURE Plans** inherit on-hold visibility without mutating their
  own Plan Status, remain displayed under the held Epic in Plan listings, and require resuming the parent Epic before
  loading.
- An on-hold **Child FEATURE Plan** whose parent **Epic** is still active remains displayed under that Epic with
  `on_hold` status instead of moving to a separate held-child list.
- A legacy **Task** has exactly one **Assignee** and may depend on zero or more other legacy **Tasks**.
- Legacy **Task Dispatch** sends each ready **Task** to an **Agent Session** for its **Assignee**.
- A legacy non-Epic `PROJECT` Task graph ends with exactly one **Integration Point** before Workflow Validation can
  begin.
- A **See-Image Tool** uses **Vision Fallback** only when the active Agent model is text-only; pasted image references
  are scoped to the current **Agent Session** and may be rehydrated when that session is resumed.
- An execution **Agent Session** must emit **Task Completion** before the workflow can proceed to **Workflow
  Validation**.
- **Workflow Validation** runs after completed executable Plan loops. For PROJECT Epics, validation occurs on child
  FEATURE Plans; the Epic itself is a decomposition container.
- `QUICK_FIX` work ends when the **Operator** emits **Task Completion**; the **Operator** is responsible for any needed
  self-verification before that signal.
- A **Scope Escalation** should present the larger-scope finding to the user and ask whether to continue via Router
  rather than abruptly calling the **Return-to-Router Tool**.
- Every **Agent Session** loads exactly one **Agent Definition** after bundled, home, and local layers are merged.
- An **Agent** owns work and may load one or more **Skills** to apply specialized techniques without changing the owning
  Agent Session.
- The **Tester** may load a **Testing Skill** to add focused regression tests when verification uncovers a real defect;
  whether it fixes now or reports only may be governed by project or user preference.
- Every active Agent turn uses the same **Agent Handler**; boot, `/agent`, `return_to_router`, and workflow restores
  must not install Agent-specific handlers.
- **Core Memories** are injected into every **Agent Session** by the **Mnemosyne** extension.
- **Prompt Templates** become slash commands in the **TUI**.
- A **Workflow Decision** may cause workflow code to record a **Plan Event**, but it is not itself durable state.
- A **Workflow Decision** describes the caller's next runtime action; the phase function that reaches a durable
  lifecycle moment records the corresponding **Plan Event**.
- A **Workflow Decision** reason code describes workflow semantics such as missing Plan declaration or canceled Review
  Loop, not raw tool outcome names.

## Example dialogue

> **Dev:** "A user submitted the **User Request** 'add JWT auth to the API'. What happens first?"
>
> **Domain expert:** "The **Router** is the default Agent for fresh **Triage**. It emits one **Triage Report** with a
> **Routing Intent**, **Complexity**, summary, and **Affected Paths**."
>
> **Dev:** "Since that spans multiple files, is it a **FEATURE**?"
>
> **Domain expert:** "Yes. The **Planner** writes a **Plan**, then the user reviews it in **Plannotator** during the
> **Review Loop**."
>
> **Dev:** "If the user denies it, does the **Engineer** start anyway?"
>
> **Domain expert:** "No. The denied **Plan** returns **Feedback**, the **Planner** makes a **Revision**, and execution
> waits until the Plan is approved."
>
> **Dev:** "What changes for a **PROJECT**?"
>
> **Domain expert:** "The **Architect** writes the **Epic** design Plan, the **Slicer** decomposes it into child
> **FEATURE** Plans, and the user loads those child Plans independently. The old task-DAG path is legacy compatibility,
> not the default PROJECT workflow."

## Flagged ambiguities

- "router", "dispatcher", and "orchestrator" were used interchangeably; resolved: **Router** is an Agent, while the
  **Workflow Orchestrator** coordinates workflow steps after Custom Tool outcomes.
- "agent def" and "agent config" appeared as aliases; resolved: use **Agent Definition** for the markdown source, and
  use **Agent Name** or **Agent Display Name** only for identifiers.
- "feedback" can mean any response in ordinary prose; resolved: **Feedback** means Plannotator annotations returned to a
  planning Agent.
- "completed" can describe either a Plan lifecycle state or an execution signal; resolved: use **Implemented Plan** for
  finished work, **Verified Plan** for proven work, and **Task Completion** for the `task_completed` tool outcome.
- "approved" previously meant both user-approved and executable; resolved: only **Ready For Work** means executable.
- "workflow outcome" sounded durable and overlapped with **Plan Event** and **Plan Status**; resolved: use **Workflow
  Decision** for ephemeral routing instructions after interpreting runtime results.
