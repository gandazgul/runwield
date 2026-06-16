# PRD: PROJECT Decomposition into Executable FEATUREs

**Status:** Draft v1 **Author:** Gandazgul **Last Updated:** 2026-06-15

---

## 1. Objective

Reframe the PROJECT classification from "execute a massive task DAG in one shot" to "design first, then decompose into
independently shippable FEATURE plans." The Slicer becomes an interactive PM/lead-engineer that helps the user break the
Epic into executable units. Each FEATURE plan follows the existing FEATURE lifecycle (plan → review → execute → validate
→ merge), and the user decides scope — one FEATURE as an MVP, all of them, or deferring some to later.

## 2. Problem Statement

Harns currently has two execution paths for non-trivial work:

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

| Decision                                                                                               | Rationale                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PROJECT = container, not executable**                                                                | Router says "this is a PROJECT" — meaning "too big to execute directly." The system's job is to refine the design, then decompose into executable FEATUREs. The PROJECT plan (Epic) is never executed directly.                                                                      |
| **Epic plan lifecycle: `draft → approved → ready_for_work → in_progress → completed`, plus `on_hold`** | A clean lifecycle that tracks the Epic's aggregate state. `ready_for_work` means decomposition is complete and children exist. Completed is re-entrant — a new child can be added later. `on_hold` is a general plan status for deferred work.                                       |
| **FEATURE plan lifecycle unchanged**                                                                   | Each child of an Epic is a regular FEATURE plan with its own existing lifecycle: `draft → approved → ready_for_work → in_progress → implemented → verified`. The FEATURE execution path is untouched.                                                                                |
| **Slicer is an interactive agent**                                                                     | The Slicer transitions from a silent one-shot prompt call to an interactive PM/lead-engineer session. It converses with the user to propose chunk boundaries, iterate on decomposition, and only writes FEATURE plans when the user confirms. The session can be paused and resumed. |
| **Architect stays the same**                                                                           | The Architect writes a full design doc (the Epic). It may be clued into the goal of "this will be decomposed later" but the output format is the same. The Epic is a living document — the Architect can revise it as implementation reveals new information.                        |
| **Loose parent-child pointers**                                                                        | Each FEATURE plan has a `parentPlan` front matter field pointing to its Epic. The Epic does not strictly list children — the system discovers them by scanning `parentPlan`. This is a one-directional, loose coupling.                                                              |
| **Subdirectory naming**                                                                                | FEATURE plans live under `plans/<epic-name>/01-description.md`. This groups them naturally and makes `hns plans` output clean.                                                                                                                                                       |
| **`load-plan` is Epic-aware**                                                                          | Loading an Epic in `draft`/`approved` resumes the Slicer session. Loading an Epic in `ready_for_work` asks "Slicer to revise, or pick a FEATURE to execute?" Loading a FEATURE plan works as today.                                                                                  |
| **Execution DAG machinery kept as dead code**                                                          | `project-executor.js` and `task-scheduling.js` remain in the codebase but unused. Future: multi-role FEATUREs (engineer → tester → doc-writer within a single FEATURE plan) may revive them.                                                                                         |
| **Design is a living document**                                                                        | The Epic plan is not frozen after approval. When a FEATURE reveals new information, the Architect revises the Epic. Affected child FEATUREs get stale flags. The user can re-run the Slicer to re-slice.                                                                             |
| **`on_hold` is a general plan status**                                                                 | Any plan (Epic or FEATURE) can be put on hold. The system does not prompt about on_hold plans. This is deferred to a follow-up PRD.                                                                                                                                                  |

## 4. Technical Approach

### 4.1 The Reframe

```
Current:
  PROJECT → Architect writes design → Slicer appends task DAG → All tasks execute in one worktree

Proposed:
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
    05-admin-dashboard.md                           (FEATURE plan — on_hold)
```

The subdirectory groups FEATUREs under their Epic. The numbered prefix is a convention set by the Slicer to hint at
dependencies — the Slicer decides the ordering during the decomposition conversation.

### 4.3 Front Matter Fields

#### Epic Plan (`plans/payment-system.md`)

```yaml
---
classification: PROJECT
type: epic
status: in_progress
---
```

- `classification: PROJECT` signals the triage origin
- `type: epic` distinguishes Epics from PROJECT plans that may exist in older formats
- `status` follows the Epic lifecycle: `draft → approved → ready_for_work → in_progress → completed` (+ `on_hold`)

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
   `classification: PROJECT` and `type: epic`. Since the Epic has no executable children, it offers the Slicer.
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
- The Slicer tracks which FEATUREs the user has deferred (marked as `on_hold` or simply not generated)
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

```
                    ┌─────────┐
                    │  draft  │ ← Architect writing the design
                    └────┬────┘
                         │ review_approved
                    ┌────▼────┐
                    │approved │ ← Design approved, ready for decomposition
                    └────┬────┘
                         │ readiness_passed (Slicer finished → children exist)
                    ┌────▼────────┐
                    │ready_for_work│ ← Decomposition complete, user can pick FEATUREs
                    └────┬────────┘
                         │ execution_started (first FEATURE picked)
                    ┌────▼──────────┐
                    │  in_progress   │ ← Children are being executed
                    └────┬──────────┘
                         │ all children verified || user declares done
                    ┌────▼───────────┐
                    │   completed    │ ← All FEATUREs done, Epic is complete
                    └────┬───────────┘
                         │ new child assigned
                    ┌────▼──────────┐
                    │  in_progress  │ ← Re-entered when new work appears
                    └───────────────┘

Also: any state can transition to on_hold (deferred) and back.
```

State transitions are recorded via the existing `recordPlanEvent` mechanism, with the following new events:

| Event               | From          | To               | Meaning                                        |
| ------------------- | ------------- | ---------------- | ---------------------------------------------- |
| `readiness_passed`  | `approved`    | `ready_for_work` | Slicer finished decomposition, children exist  |
| `all_children_done` | `in_progress` | `completed`      | All FEATURE children are in `verified` status  |
| `child_reassigned`  | `completed`   | `in_progress`    | A new FEATURE child was added after completion |

The Epic lifecycle reuses the existing plan-lifecycle infrastructure. No new state machine framework is needed — just
new event-to-status mappings.

### 4.6 `load-plan` Epic Awareness

Currently, `load-plan` loads a plan and offers execution. For Epics, the behavior must change:

| Plan type | Status                           | Behavior                                                                  |
| --------- | -------------------------------- | ------------------------------------------------------------------------- |
| FEATURE   | any                              | Existing behavior (execute if `ready_for_work`, etc.)                     |
| Epic      | `draft` / `approved`             | Resume Slicer session for decomposition                                   |
| Epic      | `ready_for_work` / `in_progress` | Ask: "Open Slicer to revise decomposition, or pick a FEATURE to execute?" |
| Epic      | `completed`                      | Show summary of completed FEATUREs                                        |
| Epic      | `on_hold`                        | Show "this Epic is deferred"                                              |

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
  ├─ 04-refund-flow              on_hold          Deferred
  └─ 05-admin-dashboard          draft

Standalone Plans:
  fix-login-bug                  verified         Merged
  add-dark-mode                  ready_for_work
```

The system discovers Epic children at listing time by scanning for `parentPlan` pointers. This is efficient enough for
the plan count in any real project (< 100 plans).

### 4.8 Architecture: What Changes vs What Stays

**Stays (unchanged):**

- `src/shared/workflow/workflow.js` — the `executePlan` function. It already handles FEATURE and PROJECT. PROJECT path
  will now check if the plan is an Epic (non-executable) and route accordingly.
- `src/shared/workflow/plan-lifecycle.js` — the state machine framework. New event mappings added.
- `src/shared/session/session.js` — session infrastructure. Slicer sessions reuse this.
- `src/cmd/load-plan/` — load-plan command. Epic awareness added as a condition at the top.

**Changes:**

- **Slicer agent** (`workflow-slicer.js` + slicer-prompt.md) — completely rewritten. From a single-prompt markdown
  mutator to a full interactive agent. New prompt: "You are a PM/lead engineer. Read the Epic design. Propose
  decomposition to the user..."
- **Readiness gate** (`workflow.js` readiness check) — updated to handle `type: epic`. Instead of calling the old Slicer
  automatically, it checks if FEATURE children exist. If not, offers the Slicer.
- **`plan-store.js`** — may need a `findPlansByParent(parentName)` helper to discover children.
- **`plan-lifecycle.js`** — add `all_children_done` and `child_reassigned` events. Add Epic states to allowed
  transitions.
- **`hns plans` command** — show hierarchy for Epics with discovered children.
- **`load-plan` command** — Epic-aware routing as described above.

**Dead code (kept, unused):**

- `src/shared/workflow/project-executor.js` — the parallel task DAG runner. Kept for future multi-role FEATUREs.
- `src/shared/workflow/task-scheduling.js` — task table parsing and conflict detection. Kept for future use.
- `src/shared/workflow/workflow-slicer.js` — replaced but kept for reference.

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
3. User is shown the available FEATUREs and can pick one to execute

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
- The user may defer some FEATUREs — mark those as on_hold.
- Write plans to `plans/<epic-name>/<nn>-<description>.md`.
- Each FEATURE plan is a regular FEATURE plan — it will be reviewed and executed independently.
```

## 5. Out of Scope (v1)

- [ ] **Multi-role FEATURE plans.** The DAG machinery (engineer → tester → doc-writer within a single FEATURE plan) is
      kept as dead code but not activated. A future PRD will define this.
- [ ] **`on_hold` status implementation.** Noted as a TODO. Any plan can be put on hold, and `hns plans` won't prompt
      about it. This deserves its own PRD.
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
- [ ] **Dependency validation at FEATURE load time** — When loading a FEATURE with `dependencies`, check if the
      dependencies are in `verified` status. Warn if not.
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
- An Epic can be re-entered after completion (a new FEATURE added later).
- The old PROJECT task-DAG execution path is still present as dead code and does not break existing tests.

## 8. References

- Existing PRD format: `docs/prd/collaborative-planning-PRD.md`, `docs/prd/theme-extensions.md`
- Current Slicer implementation: `src/shared/workflow/workflow-slicer.js` — the silent one-shot agent that will be
  replaced.
- Task execution machinery (kept as dead code): `src/shared/workflow/project-executor.js`,
  `src/shared/workflow/task-scheduling.js`
- Plan lifecycle state machine: `src/shared/workflow/plan-lifecycle.js`, `docs/plan-lifecycle.md`
- Plan store: `src/plan-store.js` — will need `findPlansByParent()` helper.
- Inspiration: [cline/kanban](https://github.com/cline/kanban) — worktree-per-card, dependency chains, auto-commit
  pattern.
