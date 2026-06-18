# PRD: PROJECT Decomposition into Executable FEATUREs

**Status:** Implemented v1 notes reconciled **Author:** Gandazgul **Last Updated:** 2026-06-18

---

## 1. Objective

Reframe the PROJECT classification from "execute a massive task DAG in one shot" to "design first, then decompose into
independently shippable FEATURE plans." The Slicer becomes an interactive PM/lead-engineer that helps the user break the
Epic into executable units. Each FEATURE plan follows the existing FEATURE lifecycle (plan → review → execute → validate
→ merge), and the user decides scope — one FEATURE as an MVP, all of them, or deferring some to later.

## 2. Problem Statement

Before this decomposition work, Harns had two execution paths for non-trivial work:

- **FEATURE**: One plan, one engineer, one worktree, validate, merge. Clean feedback loop.
- **PROJECT**: One massive design plan → Slicer silently appends a task table → all tasks execute in parallel in one
  worktree → one integration point at the end.

The PROJECT path has structural problems:

1. **All-or-nothing execution.** The user cannot stop after task 3 and call it "done" — the plan is a single unit. If
   the project is too ambitious, there is no natural exit ramp.
2. **No feedback loop between tasks.** Task 5 builds on task 3's assumptions. If task 3 is wrong, the error propagates
   through the entire DAG before the integration point catches it.
3. **Silent decomposition.** The Slicer runs as a background prompt call and appends a task table without user
   discussion. Task decomposition is a deeply human decision that the user never participates in.
4. **Frozen design.** The Architect's design is written once and approved. All tasks execute against it. If
   implementation reveals design flaws, there's no mechanism to revise the plan mid-project — only retry failed tasks.
5. **No deferred work.** Every task in the DAG must complete (or fail) before execution finishes. There is no way to
   defer a subset of work to a future iteration.

## 3. Resolved Assumptions

| Decision                                                                      | Rationale                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PROJECT = container, not executable**                                       | Router says "this is a PROJECT" — meaning "too big to execute directly." The system's job is to refine the design, then decompose into executable FEATUREs. The PROJECT plan (Epic) is never executed directly.                                                                                                      |
| **Epic plan lifecycle uses existing statuses plus `ready_for_decomposition`** | Implemented v1 uses `draft → approved → ready_for_decomposition → ready_for_work`, with optional `verified` when the user marks the Epic done enough for now. `ready_for_work` means decomposition is finalized and child FEATUREs can be selected; the Epic is still not executed directly. `on_hold` was deferred. |
| **FEATURE plan lifecycle unchanged**                                          | Each child of an Epic is a regular FEATURE plan with its own existing lifecycle: `draft → approved → ready_for_work → in_progress → implemented → verified`. The FEATURE execution path is untouched.                                                                                                                |
| **Slicer is an interactive agent**                                            | The Slicer transitions from a silent one-shot prompt call to an interactive PM/lead-engineer session. It converses with the user to propose chunk boundaries, iterate on decomposition, and only writes FEATURE plans when the user confirms. The session can be paused and resumed.                                 |
| **Architect stays the same**                                                  | The Architect writes a full design doc (the Epic). It may be clued into the goal of "this will be decomposed later" but the output format is the same. The Epic is a living document — the Architect can revise it as implementation reveals new information.                                                        |
| **Loose parent-child pointers**                                               | Each FEATURE plan has a `parentPlan` front matter field pointing to its Epic. The Epic does not strictly list children — the system discovers them by scanning `parentPlan`. This is a one-directional, loose coupling.                                                                                              |
| **Subdirectory naming**                                                       | FEATURE plans live under `plans/<epic-name>/01-description.md`. This groups them naturally and makes `hns plans` output clean.                                                                                                                                                                                       |
| **`load-plan` is Epic-aware**                                                 | Loading an Epic explains that it is not directly executable, offers Slicer decomposition, and lets the user pick child FEATUREs once decomposition is available. Loading a FEATURE plan works as today.                                                                                                              |
| **Execution DAG machinery is legacy/future machinery**                        | `project-executor.js` and `task-scheduling.js` remain in the codebase for legacy non-Epic compatibility and possible future multi-role FEATUREs. They do not define the active PROJECT Epic workflow.                                                                                                                |
| **Design is a living document**                                               | The Epic plan is not frozen after approval. Re-opening the Epic or Slicer is allowed, but stale child detection and automatic re-slicing mechanics are deferred.                                                                                                                                                     |
| **Deferred work is represented by scope, not `on_hold` in v1**                | `on_hold` status implementation was deferred. In v1, the user defers work by not generating a child FEATURE yet, leaving a child in draft, or marking the Epic done enough for now while unfinished children remain visible and loadable.                                                                            |

## 4. Technical Approach

### 4.1 The Reframe

```
Legacy:
  PROJECT → Architect writes design → Slicer appends task DAG → All tasks execute in one worktree

Implemented v1:
  PROJECT → Architect writes Epic design → Slicer (interactive) decomposes into FEATUREs
             ↓
            Each FEATURE is independently executable:
              plan → approve → execute → validate → merge
             ↓
            User decides scope: execute one FEATURE as MVP, all of them, or defer some
```

The classification-to-execution pipeline becomes:

| Classification | Behavior                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `QUICK_FIX`    | Operator executes directly (unchanged)                                                                      |
| `FEATURE`      | Planner writes plan, review, execute, validate, merge (unchanged)                                           |
| `PROJECT`      | Architect writes Epic → approved → Slicer decomposes into FEATUREs → each FEATURE follows FEATURE lifecycle |

### 4.2 Plan Layout on Disk

```
plans/
  payment-system.md                                (Epic — PROJECT, type: epic)
  payment-system/                                   (subdirectory for child FEATUREs)
    01-define-schema-and-models.md                  (FEATURE plan)
    02-implement-validation-logic.md                (FEATURE plan)
    03-stripe-integration.md                        (FEATURE plan)
    04-refund-flow.md                               (FEATURE plan)
    05-admin-dashboard.md                           (FEATURE plan — draft/deferred by user choice)
```

The subdirectory groups FEATUREs under their Epic. The numbered prefix is a convention set by the Slicer to hint at
dependencies — the Slicer decides the ordering during the decomposition conversation.

### 4.3 Front Matter Fields

#### Epic Plan (`plans/payment-system.md`)

```yaml
---
classification: PROJECT
type: epic
status: ready_for_decomposition
---
```

- `classification: PROJECT` signals the triage origin
- `type: epic` distinguishes Epics from PROJECT plans that may exist in older formats
- `status` follows the implemented Epic lifecycle: `draft → approved → ready_for_decomposition → ready_for_work`, with
  `verified` used when the user marks the Epic done enough for now

The Epic does not list its children. Children are discovered by scanning all plans for `parentPlan: payment-system`.

#### FEATURE Plan (`plans/payment-system/01-define-schema-and-models.md`)

```yaml
---
classification: FEATURE
parentPlan: payment-system
dependencies: []          # IDs of sibling FEATUREs this depends on (set by Slicer)
status: draft
---
```

- `classification: FEATURE` — this is an executable FEATURE plan
- `parentPlan` — loose pointer to the Epic it belongs to
- `dependencies` — optional list of sibling FEATUREs (by plan name or prefix number) that must be completed first
- `status` follows the existing FEATURE lifecycle

Children can be found by scanning plan front matter for `parentPlan: <epic-name>`.

### 4.4 Slicer: Interactive PM Agent

The Slicer transitions from a silent one-shot to a conversational agent.

**Entry points:**

1. **Automatic (Architect → Slicer flow):** After the Architect's Epic is approved, the readiness gate detects
   `classification: PROJECT` and `type: epic`, records `ready_for_decomposition`, and the workflow can open Slicer.
2. **Manual:** User invokes `/slicer <epic-name>` at any time.

**Session flow:**

```
1. Slicer reads the Epic plan
2. Slicer proposes initial decomposition in natural language:
   "I see 5 natural slices here. Chunk 1 is the schema, chunk 2 is validation..."
3. User discusses, merges, splits, defers, reorders
4. At any point, user can say "write a draft" → Slicer materializes FEATURE plans on disk for inspection
5. User reviews draft plans, gives feedback
6. Slicer iterates — updating FEATURE plans or proposing new boundaries
7. When user confirms → Slicer finalizes FEATURE plans
8. Epic transitions to ready_for_work
```

**Key behaviors:**

- The Slicer session is pause/resume friendly (uses existing session infrastructure under `~/.hns/sessions/`)
- "Write a draft" is a mid-conversation action — the user can see actual plan files before committing
- The Slicer tracks deferred work through the conversation; in implemented v1 deferred FEATUREs are either left as draft
  child Plans or not generated yet
- Dependencies between FEATUREs are captured in the `dependencies` front matter field

**Dependency tracking between FEATUREs:** During the decomposition conversation, the Slicer identifies which FEATUREs
depend on others (e.g., "you can't build the Stripe integration without the schema first"). These are recorded as:

```yaml
# in 02-implement-validation.md
dependencies:
    - 01-define-schema-and-models
```

When a FEATURE is loaded for execution, the system checks its dependencies and prompts the user if uncompleted
dependencies exist.

### 4.5 Epic Lifecycle State Machine

Implemented v1 uses the existing Plan Lifecycle states rather than adding a separate Epic state machine.

```
┌─────────┐
│  draft  │ ← Architect writing the design
└────┬────┘
     │ review_approved
┌────▼────┐
│approved │ ← Design approved
└────┬────┘
     │ epic_readiness_passed
┌────▼────────────────────┐
│ready_for_decomposition  │ ← Slicer can discuss/write drafts
└────┬────────────────────┘
     │ decomposition_finalized (children exist + user confirmed)
┌────▼────────┐
│ready_for_work│ ← User can pick child FEATUREs or re-open Slicer
└────┬────────┘
     │ epic_done_enough (optional user decision)
┌────▼──────┐
│ verified  │ ← Done enough for now; children remain loadable
└───────────┘
```

State transitions are recorded via the existing `recordPlanEvent` mechanism:

| Event                     | From                                  | To                        | Meaning                                                        |
| ------------------------- | ------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| `epic_readiness_passed`   | `approved`                            | `ready_for_decomposition` | The approved Epic is ready for Slicer decomposition.           |
| `decomposition_finalized` | `approved`, `ready_for_decomposition` | `ready_for_work`          | Slicer finalized at least one child FEATURE Plan.              |
| `epic_done_enough`        | `ready_for_work`, `verified`          | `verified`                | User marked the Epic done enough while children remain usable. |

The earlier `completed`, `on_hold`, `all_children_done`, and `child_reassigned` events described in the original v1
sketch were not implemented in this slice and remain future product work.

### 4.6 `load-plan` Epic Awareness

`load-plan` loads a plan and offers the action appropriate to its type. For Epics, implemented behavior is:

| Plan type | Status                                            | Behavior                                                               |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| FEATURE   | any                                               | Existing behavior (execute if `ready_for_work`, etc.)                  |
| Epic      | `draft` / `approved`                              | Explain that the Epic is not executable and offer Slicer decomposition |
| Epic      | `ready_for_decomposition`                         | Offer Slicer; offer child selection only if children already exist     |
| Epic      | `ready_for_work`                                  | Ask whether to open Slicer, pick a child FEATURE, or mark done enough  |
| Epic      | `verified` with `epicCompletionMode: done_enough` | Show done-enough summary and keep children visible/loadable            |

When the user chooses "pick a FEATURE", the system:

1. Scans for child plans via `parentPlan` pointer
2. Shows available FEATUREs with their statuses
3. User picks one → loads that FEATURE plan normally

### 4.7 `hns plans` Output Changes

The plans listing shows the Epic-FEATURE hierarchy:

```
Epics:
  payment-system (Epic)          ready_for_work  3/5 features complete
  ├─ 01-define-schema            verified         Merged
  ├─ 02-validation               verified         Merged
  ├─ 03-stripe-integration       in_progress      Active worktree
  ├─ 04-refund-flow              draft            Deferred by user choice
  └─ 05-admin-dashboard          draft

Standalone Plans:
  fix-login-bug                  verified         Merged
  add-dark-mode                  ready_for_work
```

The system discovers Epic children at listing time by scanning for `parentPlan` pointers. This is efficient enough for
the plan count in any real project (< 100 plans).

### 4.8 Architecture: What Changes vs What Stays

**Stays (unchanged):**

- `src/shared/workflow/workflow.js` — the `executePlan` function still handles executable FEATUREs and legacy non-Epic
  PROJECT plans; PROJECT Epics are guarded as non-executable containers.
- `src/shared/workflow/plan-lifecycle.js` — the state machine framework is reused.
- `src/shared/session/session.js` — session infrastructure. Slicer sessions reuse this.
- `src/cmd/load-plan/` — load-plan command owns Epic-aware routing.

**Changes:**

- **Slicer agent** (`workflow-slicer.js` + slicer-prompt.md) — rewritten from a single-prompt task-table mutator to an
  interactive decomposition agent with tools for writing draft child FEATURE plans and finalizing decomposition.
- **Readiness gate** — updated to handle `type: epic` by moving approved Epics to `ready_for_decomposition` instead of
  requiring a task table.
- **`plan-store.js`** — includes `findPlansByParent(parentName)`, child FEATURE materialization, dependency
  normalization, and nested plan resolution.
- **`plan-lifecycle.js`** — adds `ready_for_decomposition`, `epic_readiness_passed`, `decomposition_finalized`, and
  `epic_done_enough`.
- **`hns plans` command** — shows hierarchy for Epics with discovered children.
- **`load-plan` command** — routes Epics to Slicer, child selection, dependency warnings, or done-enough handling.

**Dead code (kept, unused):**

- `src/shared/workflow/project-executor.js` — the parallel task DAG runner. Kept for future multi-role FEATUREs.
- `src/shared/workflow/task-scheduling.js` — task table parsing and conflict detection. Kept for future use.
- `src/shared/workflow/workflow-slicer.js` legacy task-table path — kept for compatibility inside the same module.

### 4.9 Slicer: "Write a Draft" Mid-Session

During the Slicer conversation, the user may say "write a draft" to materialize the current decomposition as actual plan
files. This is important for the user to inspect the generated plan quality before committing.

When the user says "write a draft", the Slicer:

1. Creates FEATURE plan files under `plans/<epic-name>/<nn>-<description>.md`
2. Sets their status to `draft`
3. Does NOT advance the Epic to `ready_for_work`
4. The conversation continues — user can inspect, give feedback, and the Slicer can update the files

When the user says "finalize" or the Slicer session ends with confirmed decomposition:

1. FEATURE plans are finalized with `status: draft`
2. Epic transitions to `ready_for_work`
3. User can load the Epic to choose a child FEATURE, re-open Slicer, or later mark the Epic done enough for now

### 4.10 Slicer Prompt Design (Sketch)

The Slicer system prompt would include:

```markdown
You are the Slicer — a PM and lead engineer working with the user.

Your job:

1. Read the Epic plan to understand the full design.
2. Propose a decomposition into independent FEATURE plans.
3. Discuss boundaries, dependencies, and priorities with the user.
4. When asked, write FEATURE plan files to disk.
5. Only finalize when the user confirms the decomposition.

Guidelines:

- Each FEATURE should be independently shippable.
- Dependencies between FEATUREs should be minimal and explicit.
- The user may defer some FEATUREs — leave those as draft plans or do not generate them yet.
- Write plans to `plans/<epic-name>/<nn>-<description>.md`.
- Each FEATURE plan is a regular FEATURE plan — it will be reviewed and executed independently.
```

## 5. Out of Scope (v1)

- [ ] **Multi-role FEATURE plans.** The DAG machinery (engineer → tester → doc-writer within a single FEATURE plan) is
      not activated for PROJECT Epics. A future PRD will define this.
- [ ] **`on_hold` status implementation.** Deferred. v1 does not add a durable `on_hold` status or any prompt/listing
      behavior for it; deferred scope is handled by leaving child FEATUREs draft or not generating them yet.
- [ ] **Epic-to-Epic dependencies** (e.g., "auth epic must complete before payments epic starts"). Parent-child is
      handled; cross-Epic dependencies are deferred.
- [ ] **Architect revisiting the Epic mid-project.** The Epic is a living document, but the mechanics of flagging stale
      FEATUREs and re-invoking the Architect are deferred to a follow-up.
- [ ] **Visual board.** A kanban-style board for Epics and FEATUREs (like cline/kanban) is deferred. The CLI/TUI output
      in `hns plans` is sufficient for v1.
- [ ] **Stale child detection.** A FEATURE plan may become stale if the Epic design changes. Detection and warning
      mechanics are deferred.

## 6. TODO Items (Future Iterations)

- [ ] **`on_hold` plan status** — Define the lifecycle, front matter mechanics, and listing behavior for deferred plans
      of any classification.
- [ ] **Multi-role FEATUREs** — When a single FEATURE plan can trigger engineer → tester → doc-writer passes internally,
      revive the DAG machinery. Needs a full design.
- [ ] **Epic re-slicing** — When the Architect revises the Epic and existing FEATUREs become stale, how does the system
      flag them? Allow re-running the Slicer against a modified Epic.
- [x] **Dependency warning at FEATURE load time** — Loading a child FEATURE with `dependencies` checks whether sibling
      dependencies are `verified`, warns for missing/unverified dependencies, and lets the user choose whether to
      proceed.
- [ ] **Epic completion detection** — Automatically transition Epic to `completed` when all visible FEATURE children
      reach `verified`.
- [ ] **`hns plans` performance** — Current plan count is small (< 100). If scaling to hundreds of plans, consider
      caching child discovery results in the Epic's front matter.

## 7. Success Metrics

- A PROJECT request follows the full pipeline: Architect writes Epic → Slicer decomposes → user executes one FEATURE as
  MVP → defers the rest.
- The Slicer conversation can be paused (close session) and resumed (re-open session or `load-plan EpicName`) without
  losing decomposition state.
- `hns plans` clearly shows the Epic hierarchy with child FEATUREs.
- `load-plan` correctly distinguishes Epics from FEATUREs and offers the right action.
- The user can execute one FEATURE, verify it, merge it, and declare the Epic partially done — without executing the
  other FEATUREs.
- An Epic can be re-entered after being marked done enough for now; remaining child FEATUREs stay visible and loadable.
- The old PROJECT task-DAG execution path is retained only as legacy non-Epic compatibility/future machinery and does
  not define the active PROJECT workflow.

## 8. References

- Existing PRD format: `docs/prd/collaborative-planning-PRD.md`, `docs/prd/theme-extensions.md`
- Current Slicer implementation: `src/shared/workflow/workflow-slicer.js` — interactive Epic decomposition plus the
  legacy task-table compatibility path.
- Legacy/future task execution machinery: `src/shared/workflow/project-executor.js`,
  `src/shared/workflow/task-scheduling.js`
- Plan lifecycle state machine: `src/shared/workflow/plan-lifecycle.js`, `docs/plan-lifecycle.md`
- Plan store: `src/plan-store.js` — includes `findPlansByParent()` and child FEATURE materialization helpers.
- Inspiration: [cline/kanban](https://github.com/cline/kanban) — worktree-per-card, dependency chains, auto-commit
  pattern.
