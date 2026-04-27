`# Ubiquitous Language

## The Harness

| Term       | Definition                                                                                         | Aliases to avoid           |
| ---------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| **Harns**  | An opinionated, plan-by-default coding harness that routes user requests through triage and agents. | Harness, tool, framework   |
| **TUI**    | The terminal-based interactive user interface that hosts agent conversations and renders output.     | Shell, terminal, console   |
| **User Request** | A natural-language request submitted by the user for triage and execution (`userRequest` in code). | Prompt, message, input, query |

## Triage & Classification

| Term               | Definition                                                                                   | Aliases to avoid                      |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Triage**         | The Router's structured analysis that classifies a user request by type and complexity.       | Assessment, evaluation, analysis      |
| **Triage Report**  | The structured output of triage containing classification, complexity, summary, and affected paths. | Triage result, classification result |
| **Classification** | One of three request categories emitted by triage: `QUICK_FIX`, `FEATURE`, or `PROJECT`.    | Type, category, kind                  |
| **QUICK_FIX**      | A classification for minor changes affecting 1–2 files with no architectural implications.   | Hotfix, patch, bug fix                |
| **FEATURE**        | A classification for new functionality spanning multiple files that requires a plan.          | Enhancement, change request           |
| **PROJECT**        | A classification for large-scale architectural shifts requiring deep exploration and multi-agent execution. | Epic, initiative, refactor |
| **Complexity**     | A severity rating (`LOW`, `MEDIUM`, `HIGH`) assigned during triage.                          | Difficulty, effort, severity          |
| **Affected Paths** | An ordered list of files identified during triage as the vertical slice impacted by the request. | Impacted files, file list          |
| **Vertical Slice** | A narrow, deep trace through the codebase from entry point to boundary, scoped to one request. | Cross-section, code path            |

## Plans & Review

| Term             | Definition                                                                                                   | Aliases to avoid                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **Plan**         | A markdown file in `plans/` with YAML front matter that describes an implementation strategy for a request.  | Blueprint, spec, design doc      |
| **Front Matter** | YAML metadata at the top of a plan file containing classification, complexity, status, and timestamps.       | Metadata, header, YAML block     |
| **Plan Status**  | The lifecycle state of a plan: `draft`, `in_review`, `approved`, or `denied`.                                | Phase, stage                     |
| **Review Loop**  | The iterative cycle where an agent writes/revises a plan and the user approves or denies it via Plannotator. | Feedback loop, approval cycle    |
| **Plannotator**  | The browser-based review UI where users approve, deny, or annotate a plan.                                   | Review UI, approval screen       |
| **Feedback**     | Structured annotations returned by the user when denying a plan in Plannotator.                              | Comments, annotations, notes     |
| **Revision**     | A single pass of plan modification by an agent in response to denial feedback (max 5 per review loop).       | Iteration, update, amendment     |
| **Resume**        | Re-entering the workflow for a previously saved or denied plan.                                              | Continue, reopen, pick up        |
| **Origin**        | A plan front-matter field: `"internal"` (created by a Harns agent) or `"external"` (pre-existing markdown brought in from outside). | Source, provenance |

## Agents

| Term           | Definition                                                                                             | Aliases to avoid                  |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Agent**      | A specialized LLM-powered role with a dedicated system prompt, model binding, and tool set.            | Bot, assistant, model             |
| **Router**     | The default triage agent that classifies requests and identifies the affected vertical slice.           | Dispatcher, classifier, triager   |
| **Operator**   | The execution agent for `QUICK_FIX` tasks — direct changes with no planning phase.                     | Executor, fixer, worker           |
| **Planner**    | The planning agent for `FEATURE` requests — iteratively drafts a single-feature plan.                  | Designer, strategist              |
| **Architect**  | The planning agent for `PROJECT` requests — performs deep exploration and produces multi-task plans.    | Designer, lead                    |
| **Engineer**   | The code execution agent that implements approved plans or individual tasks.                            | Coder, implementer, developer     |

| **Tester**     | The agent responsible for writing and updating test suites based on approved plans.                     | QA, test writer                   |
| **Doc Writer** | The agent responsible for creating and updating technical documentation artifacts.                      | Documenter, tech writer           |
| **Agent Def**  | A markdown file in `.pi/agents/` with front matter (name, model) and a system prompt body.             | Agent prompt, agent config        |

## Execution & Tasks

| Term               | Definition                                                                                                 | Aliases to avoid                |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Task**           | A numbered, assignable unit of work inside a `PROJECT` plan, with an assignee and dependency list.         | Step, subtask, work item        |
| **Assignee**       | The agent role (`engineer`, `tester`, `doc-writer`) designated to execute a task.                           | Owner, handler, responsible     |
| **Task Dispatch**  | The process of executing tasks in dependency order, routing each to its assigned agent.                     | Task execution, orchestration   |
| **Agent Session**  | A single agent invocation (`runAgentSession`): loading an agent def, binding tools and extensions, then running to completion. | Run, interaction, conversation |
| **Toolset**        | A named bundle of tool names (`ROUTER`, `OPERATOR`, `PLANNING`, `ENGINEER`, `DOC_WRITER`) granted to an agent invocation. | Tool list, capabilities    |
| **Custom Tool**    | A Harns-defined tool (e.g., `triage_report`, `plan_written`) registered alongside built-in pi tools.       | Internal tool, harns tool       |

## Memory & Persistence

| Term              | Definition                                                                                                   | Aliases to avoid                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| **Mnemosyne**     | The external persistent memory system that stores, searches, and manages project and global memories.        | Memory layer, memory store         |
| **Memory**        | A single concise fact, decision, or preference stored in Mnemosyne for future retrieval.                     | Note, record, entry                |
| **Core Memory**   | A memory tagged `core` that is automatically injected into every agent's system prompt.                      | Critical memory, pinned memory     |
| **Global Memory** | A memory stored in the cross-project collection, available regardless of which project is active.            | Shared memory, universal memory    |
| **Sleep**         | A maintenance invocation that exports, analyzes, and optimizes the memory collection for signal quality.     | Memory cleanup, memory maintenance |
| **Project Name**  | The basename of the working directory, used as the Mnemosyne collection identifier.                          | Collection, namespace              |

## Relationships

- A **User Request** is classified by the **Router** into exactly one **Triage Report**.
- A **Triage Report** contains one **Classification** (`QUICK_FIX`, `FEATURE`, or `PROJECT`) and one **Complexity** rating.
- A **QUICK_FIX** is executed directly by the **Operator** — no **Plan** is created.
- A **FEATURE** is handled by the **Planner**, who produces exactly one **Plan**.
- A **PROJECT** is handled by the **Architect**, who performs its own deep vertical-slice exploration and produces one **Plan** containing one or more **Tasks**.
- A **Plan** goes through a **Review Loop** via **Plannotator**; each denial triggers a **Revision** (up to 5).
- An approved **Plan** is executed by the **Engineer** (for `FEATURE`) or dispatched as **Tasks** to multiple **Agents** (for `PROJECT`).
- Each **Task** has one **Assignee** (`engineer`, `tester`, or `doc-writer`) and may depend on other **Tasks**.
- Every **Agent** runs in an **Agent Session** with a specific **Toolset** and optional **Custom Tools**.
- **Core Memories** are injected into every **Agent Session** via the **Mnemosyne** extension's `before_agent_start` hook.
- A **Plan** can be **Resumed** from any non-terminal status to re-enter the **Review Loop** or proceed to execution.

## Example dialogue

> **Dev:** "A user submitted the **User Request** 'add JWT auth to the API'. What happens first?"
>
> **Domain expert:** "The **Router** performs **triage** — it explores the codebase, then emits a **Triage Report** via the `triage_report` tool. Since this spans multiple files, the **Classification** will be `FEATURE`."
>
> **Dev:** "So it goes to the **Planner** next?"
>
> **Domain expert:** "Exactly. The **Planner** receives the **Triage Report** and the original **User Request**, explores the **Affected Paths**, then writes a **Plan** to `plans/implement-jwt-auth.md`."
>
> **Dev:** "And the user reviews it in **Plannotator**?"
>
> **Domain expert:** "Right. The **Review Loop** starts — **Plannotator** opens in the browser. If the user denies with **Feedback**, the **Planner** gets a **Revision** pass. This can happen up to 5 times."
>
> **Dev:** "Once approved, who executes it?"
>
> **Domain expert:** "The **Engineer**. For a `FEATURE`, there's a single **Session** that walks through the **Plan** steps. For a `PROJECT`, the **Architect** would have included a **Tasks** table, and each **Task** gets dispatched to its **Assignee** — could be `engineer`, `tester`, or `doc-writer`."
