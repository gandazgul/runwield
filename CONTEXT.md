# Harns Context

Harns is an opinionated, plan-by-default coding harness that routes development requests through triage, planning,
review, execution, and validation. This context defines the project language used by agents, docs, plans, and code.

## Language

### Harness

**Harns**: The plan-by-default coding harness that routes user requests through triage and specialized agents. _Avoid_:
Harness, tool, framework

**TUI**: The terminal-based interactive user interface that hosts agent conversations and renders workflow output.
_Avoid_: Shell, console

**User Request**: A natural-language request submitted by the user for triage and execution. _Avoid_: Prompt, input,
query

### Triage & Classification

**Triage**: The Router's structured classification of a User Request by workflow type and complexity. _Avoid_:
Assessment, evaluation, analysis

**Triage Report**: The structured output of Triage containing classification, complexity, summary, and affected paths.
_Avoid_: Triage result, classification result

**Classification**: Exactly one workflow category emitted by Triage: `QUICK_FIX`, `FEATURE`, or `PROJECT`. _Avoid_:
Type, category, kind

**QUICK_FIX**: A Classification for a small direct change with no planning phase. _Avoid_: Hotfix, patch, bug fix

**FEATURE**: A Classification for new functionality that requires a reviewed implementation Plan. _Avoid_: Enhancement,
change request

**PROJECT**: A Classification for large architectural or multi-role work that requires deep exploration and task
dispatch. _Avoid_: Epic, initiative, refactor

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

**Plan Status**: The lifecycle state of a Plan: `draft`, `feedback`, `approved`, `ready_for_work`, `in_progress`,
`failed`, `implemented`, or `verified`. _Avoid_: Phase, stage

**Plan Lifecycle**: The state machine that decides how Plan Events change Plan Status and recovery metadata; see
`docs/plan-lifecycle.md`. _Avoid_: Status helper, plan status logic

**Plan Event**: A recorded workflow fact that the Plan Lifecycle uses to transition a Plan. _Avoid_: Next step, status
update

**Approved Plan**: A Plan whose Review Loop ended in user approval but whose pre-execution preparation may still be
unfinished. _Avoid_: Ready plan, executable plan

**Ready For Work**: The only executable Plan Status, meaning a Plan is approved and every pre-execution prerequisite is
satisfied. _Avoid_: Approved, executable, runnable

**Readiness Gate**: The classification-aware lifecycle step that promotes an Approved Plan to Ready For Work once
pre-execution preparation is complete. _Avoid_: Slicer phase, execution check

**Failed Plan**: A Plan that reached Ready For Work but could not complete execution successfully. _Avoid_: Rejected
plan, invalid plan

**In-Progress Plan**: A Plan whose execution has started and whose worktree may contain partial implementation work.
_Avoid_: Running plan, active plan

**Plan Recovery**: Choosing how to continue an In-Progress Plan or Failed Plan from the current worktree state. _Avoid_:
Resume, restart

**Failure Detail**: A durable explanation of why a Failed Plan could not complete work. _Avoid_: Error log, crash dump

**Implemented Plan**: A Plan whose execution work finished but whose Workflow Validation has not yet passed. _Avoid_:
Completed plan, done plan

**Verified Plan**: A Plan whose execution and Workflow Validation both finished successfully. _Avoid_: Completed plan,
done plan

**Review Loop**: The cycle where a planning agent writes or revises a Plan and the user approves or returns it through
Plannotator. _Avoid_: Feedback loop, approval cycle

**Plannotator**: The browser-based review UI where users approve, save, deny, or annotate a Plan. _Avoid_: Review UI,
approval screen

**Feedback**: Structured user annotations returned when a Plan is denied or re-opened in Plannotator. _Avoid_: Comments,
notes

**Revision**: A single planning pass that updates a Plan in response to Feedback. _Avoid_: Iteration, amendment

**Resume**: Re-entering workflow for an existing Plan or session instead of starting from a fresh User Request. _Avoid_:
Continue, reopen, pick up

**Origin**: A Plan Front Matter value of `internal` for Harns-created plans or `external` for imported markdown.
_Avoid_: Source, provenance

### Agents

**Agent**: A specialized LLM-powered role with a dedicated Agent Definition, model binding, and tool set. _Avoid_: Bot,
assistant, model

**Router**: The default triage Agent that classifies a User Request and identifies its Affected Paths. _Avoid_:
Dispatcher, orchestrator, classifier, triager

**Operator**: The execution Agent for `QUICK_FIX` work. _Avoid_: Executor, fixer, worker

**Planner**: The planning Agent for `FEATURE` work. _Avoid_: Designer, strategist

**Architect**: The planning Agent for `PROJECT` work. _Avoid_: Designer, lead

**Slicer**: The Agent that converts an approved PROJECT design Plan into executable task slices. _Avoid_: Task planner,
splitter

**Engineer**: The execution Agent that implements approved Plans or individual Tasks. _Avoid_: Coder, implementer,
developer

**Tester**: The Agent that writes or updates tests for assigned Tasks. _Avoid_: QA, test writer

**Doc Writer**: The Agent that creates or updates technical documentation for assigned Tasks. _Avoid_: Documenter, tech
writer

**Agent Definition**: A markdown file with YAML Front Matter defining an Agent's display name, model, tools, and system
prompt. _Avoid_: Agent def, agent prompt, agent config

**Agent Name**: The internal identifier for an Agent, derived from its Agent Definition filename without `.md`. _Avoid_:
Display name, label

**Agent Display Name**: The human-readable name in Agent Definition Front Matter used when rendering agent messages.
_Avoid_: Agent name, file name

**Agent Session**: One invocation of an Agent with merged Agent Definition data, bound tools, extensions, and message
history. _Avoid_: Run, interaction, conversation

### Execution & Tools

**Workflow Orchestrator**: The runtime coordinator that consumes tool outcomes and starts the next Agent Session.
_Avoid_: Router, dispatcher agent

**Task**: A numbered, assignable unit of work inside a `PROJECT` Plan with an assignee and dependency list. _Avoid_:
Step, subtask, work item

**Assignee**: The Agent role designated to execute a Task. _Avoid_: Owner, handler, responsible

**Task Dispatch**: Executing PROJECT Tasks in dependency order by routing each Task to its Assignee. _Avoid_: Task
execution, orchestration

**Task Completion**: The `task_completed` signal an execution Agent emits when its assigned work is complete. _Avoid_:
Done message, final response

**Workflow Validation**: Harns' independent verification pass after a completed workflow loop. _Avoid_: Agent
self-check, final summary

**Toolset**: A named bundle of tool names granted to an Agent Session. _Avoid_: Tool list, capabilities

**Custom Tool**: A Harns-defined tool registered alongside built-in pi tools. _Avoid_: Internal tool, Harns tool

**Triage-Report Tool**: The `triage_report` Custom Tool that emits a Triage Report and ends the Router turn. _Avoid_:
Classification tool, triage result tool

**Plan-Written Tool**: The `plan_written` Custom Tool that starts the Review Loop and returns the Plan outcome. _Avoid_:
Review tool, approval tool

**Switch-Agent Tool**: The `switch_agent` Custom Tool that hands a conversation to another Agent. _Avoid_: Handoff tool,
agent router

**User-Interview Tool**: The `user_interview` Custom Tool for structured clarification questions. _Avoid_: Question
tool, clarification form

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

**Prompt Template**: A layered markdown template that defines a slash command available in the TUI. _Avoid_: Slash
command definition, prompt command

## Relationships

- A **User Request** is classified by the **Router** into exactly one **Triage Report**.
- A **Triage Report** contains exactly one **Classification**, one **Complexity**, one summary, and zero or more
  **Affected Paths**.
- A **QUICK_FIX** is executed directly by the **Operator** and creates no **Plan**.
- A **FEATURE** is planned by the **Planner**, reviewed through one **Review Loop**, and executed by the **Engineer**
  after approval.
- A **PROJECT** is planned by the **Architect**, optionally sliced by the **Slicer**, and executed as one or more
  **Tasks**.
- A **Plan** has exactly one **Plan Status**, exactly one **Origin**, and one **Front Matter** block.
- A **Plan Event** is the only way workflow code should ask the **Plan Lifecycle** to change Plan Status.
- An **Approved Plan** passes through the **Readiness Gate** before becoming **Ready For Work**.
- A **Plan** can proceed to execution only when its **Plan Status** is **Ready For Work**.
- A **Failed Plan** must have reached **Ready For Work** before work failed.
- An **In-Progress Plan** requires recovery because execution may have partially changed the worktree.
- **Plan Recovery** resolves whether Harns continues the current worktree state, reports on it, re-opens the Plan, or
  returns the worktree to a known pre-execution state.
- A **Failed Plan** should include **Failure Detail** when Harns can identify the cause.
- An **Implemented Plan** still requires **Workflow Validation**.
- An **Implemented Plan** may include **Failure Detail** when Workflow Validation fails.
- A **Verified Plan** must have passed **Workflow Validation**.
- A denied **Plan** produces **Feedback**, and each **Feedback** response triggers one **Revision**.
- A **Task** has exactly one **Assignee** and may depend on zero or more other **Tasks**.
- **Task Dispatch** sends each ready **Task** to an **Agent Session** for its **Assignee**.
- An execution **Agent Session** must emit **Task Completion** before the workflow can proceed to **Workflow
  Validation**.
- **Workflow Validation** runs only after completed `FEATURE` and `PROJECT` Plan execution loops.
- `QUICK_FIX` work ends when the **Operator** emits **Task Completion**; the **Operator** is responsible for any needed
  self-verification before that signal.
- Every **Agent Session** loads exactly one **Agent Definition** after bundled, home, and local layers are merged.
- **Core Memories** are injected into every **Agent Session** by the **Mnemosyne** extension.
- **Prompt Templates** become slash commands in the **TUI**.

## Example dialogue

> **Dev:** "A user submitted the **User Request** 'add JWT auth to the API'. What happens first?"
>
> **Domain expert:** "The **Router** performs **Triage** and emits one **Triage Report** with a **Classification**,
> **Complexity**, summary, and **Affected Paths**."
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
> **Domain expert:** "The **Architect** writes the design Plan, the **Slicer** can turn it into **Tasks**, and **Task
> Dispatch** routes each Task to its **Assignee** such as **Engineer**, **Tester**, or **Doc Writer**."

## Flagged ambiguities

- "router", "dispatcher", and "orchestrator" were used interchangeably; resolved: **Router** classifies User Requests,
  while **Workflow Orchestrator** coordinates post-triage Agent Sessions.
- "agent def" and "agent config" appeared as aliases; resolved: use **Agent Definition** for the markdown source, and
  use **Agent Name** or **Agent Display Name** only for identifiers.
- "feedback" can mean any response in ordinary prose; resolved: **Feedback** means Plannotator annotations returned to a
  planning Agent.
- "completed" can describe either a Plan lifecycle state or an execution signal; resolved: use **Implemented Plan** for
  finished work, **Verified Plan** for proven work, and **Task Completion** for the `task_completed` tool outcome.
- "approved" previously meant both user-approved and executable; resolved: only **Ready For Work** means executable.
