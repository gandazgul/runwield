# Product Requirements Document: Frontend Engineer and Pair Execution

**Status:** Proposed\
**Date:** 2026-07-17 EDT

## Objective

Make RunWield materially better at frontend development by introducing a first-class **Frontend Engineer** Agent and an
optional **Pair Execution** style for iterative visual work.

Frontend Engineer should combine design-system-aware implementation, a persistent headed-browser feedback loop, and
normal RunWield execution discipline. Users should be able to refine visual treatment through meaningful checkpoints
without abandoning the approved Plan, restarting execution, or waiting until final verification to see the result.

The same Agent must also support autonomous execution when the user prefers AFK work.

## Problem Statement

RunWield's current frontend experience has the right low-level ingredients but the wrong execution shape:

- `frontend: true` conflates touching frontend code, requiring browser verification, selecting an execution owner, and
  preferring live collaboration.
- General Engineer has accumulated substantial frontend policy in addition to its language-agnostic execution duties.
  Loading a frontend Skill does not remove the competing instructions or single-turn completion pressure.
- Frontend execution is still framed as “follow the Plan, then verify.” A headed browser may be open, but RunWield does
  not deliberately create visual increments and wait for user judgment.
- Live steering is available but passive. The user must notice the right moment and interrupt before the Agent completes
  too much work.
- End-of-work Manual QA automation would detect some behavioral failures, but it would not improve the iterative design
  experience that causes the dissatisfaction.
- Deterministic browser frameworks such as Playwright can preserve stable behavior, but they cannot decide whether a
  novel visual treatment, information density, animation, or interaction feel is desirable.

The product needs to distinguish frontend specialization, collaboration style, and verification requirements rather than
treating them as one boolean or one final QA gate.

## Product Principles

1. **Frontend is a distinct execution discipline.** Materially visual or interactive work deserves a dedicated Agent
   identity, prompt, tool policy, and model configuration.
2. **Pairing is optional, not synonymous with frontend.** Frontend Engineer can work through Pair Execution or
   autonomously; the user chooses.
3. **Plan the intent, iterate the treatment.** An approved Plan settles the outcome, constraints, states, behavior, and
   design basis without pretending the final visual treatment is knowable before implementation.
4. **Use the real application early.** Frontend work begins with the normal app running in a headed browser, not with a
   final browser check after all edits are complete.
5. **Block deliberately, not continuously.** Pair Execution pauses after coherent visible increments rather than
   narrating every edit or relying on opportunistic steering.
6. **Automation preserves stable behavior.** Existing browser tests remain valuable, but RunWield does not impose a new
   test framework or brittle visual snapshots on every frontend project.
7. **Pair approval is not verification.** User feedback during implementation does not replace normal Workflow
   Validation, browser verification, or optional code review.

## Target Users and Outcomes

The primary user is a developer using RunWield to implement or refine a web interface in an existing project.

A successful experience lets that user:

- rely on Planner to discover the project's design system and identify relevant existing UI patterns;
- understand why Pair or autonomous execution is recommended;
- choose Pair or AFK execution without changing the execution Agent;
- watch the real application update through HMR when available;
- give feedback after bounded visual increments;
- switch the remaining work to AFK at any checkpoint;
- preserve the same worktree, Agent context, dev server, and browser session across iterations;
- finish with normal automated and browser verification;
- avoid unsolicited Playwright installation or snapshot-test churn.

## Resolved Assumptions

### Agent ownership

- **Frontend Engineer** is a first-class Agent, not Engineer with an extra Skill or temporary prompt overlay.
- Frontend Engineer owns Plans whose primary outcome is materially visual or interactive.
- A frontend-owned Plan may include supporting backend work when that work is part of the same vertical slice.
- Pair and autonomous execution use the same Frontend Engineer identity.
- Validation feedback and repair return to Frontend Engineer so execution context and domain ownership do not drift.
- The existing frontend and browser Skills remain reusable technique packages; they do not replace Agent ownership.

### Planning boundary

- Planner must inspect relevant design-system documentation, shared primitives, tokens, neighboring screens, and source
  conventions before finalizing a frontend-owned Plan.
- Planner resolves the user outcome, interaction behavior, important states, constraints, accessibility expectations,
  responsive expectations, and known design-system references.
- Pair Plans may deliberately leave final spacing, composition, hierarchy, motion, and other visual treatment open for
  execution-time refinement.
- Planner recommends Pair Execution when user taste or visual exploration materially affects success. Merely touching a
  frontend file is insufficient.
- The user chooses Pair or autonomous execution when work starts.
- Ordinary treatment refinements remain within the approved Plan. Feedback that changes capability, information
  architecture, or material scope returns to planning.
- Highly ambiguous concepts may be prototyped before Plan approval rather than turning Pair Execution into open-ended
  product discovery.

### Pair Execution behavior

- Pair Execution uses blocking checkpoints after meaningful visible increments.
- Before a checkpoint, Frontend Engineer must update the real UI and gather relevant evidence, such as the current
  browser state, screenshot, viewport, console errors, network failures, or accessibility structure.
- At a checkpoint the user can:
  - continue to the next increment;
  - provide revision feedback;
  - switch the remaining work to autonomous execution; or
  - stop while leaving the Plan in progress.
- A checkpoint is not Task Completion, an execution failure, Manual QA, or Workflow Validation.
- RunWield should prefer its existing non-terminal interaction broker for checkpoints. A new Plan Status or terminal
  workflow tool is unnecessary unless implementation discovery proves the existing interaction contract insufficient.
- Non-interactive execution cannot require Pair checkpoints and therefore runs autonomously.

### Browser verification and deterministic tests

- Both Pair and autonomous frontend execution require real-browser verification unless an external capability makes it
  genuinely impossible.
- Frontend Engineer follows the project's existing browser-test framework and conventions when present.
- Introducing Playwright or another browser automation framework must be explicit in the approved Plan.
- Frontend Engineer must not install a framework or add visual snapshots solely because work is frontend.
- Agent-driven browser inspection covers exploratory and visual iteration; CI owns stable behavior already codified as
  deterministic tests.

### External feasibility basis

Current official Playwright documentation confirms support for generated browser scripts, UI mode, trace viewing,
managed development servers, browser/device projects, and screenshot assertions. These capabilities make Playwright a
strong durable automation option when a project chooses it, but they do not replace user judgment during visual design.

Primary references:

- [Test generator](https://playwright.dev/docs/codegen)
- [UI mode](https://playwright.dev/docs/test-ui-mode)
- [Trace viewer](https://playwright.dev/docs/trace-viewer)
- [Visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Development server configuration](https://playwright.dev/docs/test-webserver)

## Technical Approach

### 1. Introduce Frontend Engineer as an execution Agent

Frontend Engineer receives its own Agent Definition, model settings, tool policy, and behavioral prompt. Its policy
should retain RunWield's shared execution invariants while focusing its attention on:

- design-system and convention discovery;
- browser and dev-server preflight before implementation;
- small coherent visual increments;
- HMR-aware iteration;
- responsive, accessibility, content-resilience, console, and network checks;
- Pair checkpoints when selected;
- normal Task Completion only after implementation and verification are complete.

Frontend Engineer should be independently configurable so users can select a vision-capable model without changing the
general Engineer configuration.

### 2. Separate Plan concerns

The planning and execution contracts must represent three independent product decisions:

1. whether Frontend Engineer owns execution;
2. whether Planner recommends Pair or autonomous execution; and
3. what browser and deterministic verification the Plan requires.

The exact Front Matter representation is deferred to implementation planning. Existing `frontend: true` Plans require a
clear compatibility interpretation rather than silently changing behavior.

### 3. Dispatch by execution ownership

When a frontend-owned Plan starts, RunWield activates Frontend Engineer instead of general Engineer. In an interactive
host, RunWield presents Planner's collaboration recommendation and lets the user choose Pair or autonomous execution.
Non-interactive hosts use autonomous execution.

The selected execution style belongs to the active execution workflow, not to Agent identity or Plan Status.

### 4. Run the frontend feedback loop

Frontend Engineer starts or repairs the project's normal development surface, opens the exact target route in a headed
browser, and identifies whether HMR is active. In Pair Execution it then repeats:

1. implement one coherent visible increment;
2. observe the updated application through the browser;
3. check relevant browser diagnostics and capture visual evidence;
4. block for user direction;
5. revise, continue, switch to AFK, or stop according to the response.

The same Agent Session and execution worktree should continue across responses. Dev-server and browser lifecycle should
be managed so checkpoints do not force repeated startup or lose the state being discussed.

### 5. Preserve normal completion and validation

After Pair or autonomous implementation finishes, Frontend Engineer emits normal Task Completion. Existing Workflow
Validation then runs as appropriate. Semantic review, user code review, CI, merge-back, and recovery semantics remain
separate from Pair checkpoints.

Any implementation repair discovered by validation returns to Frontend Engineer. Whether a repaired visual change
requires another Pair checkpoint should follow the active execution style and the materiality of the visible change.

### 6. Observe product effectiveness

Opt-in workflow metrics may record coarse, content-free facts such as:

- Planner recommendation and user selection;
- number of checkpoints;
- continue, revise, switch-to-AFK, and stop decisions;
- successful completion or abandonment;
- elapsed execution time;
- browser preflight success or external blockage.

Metrics must not capture screenshots, user feedback text, source content, URLs containing secrets, or browser payloads.

## Success Criteria

The first complete product slice succeeds when:

- Planner distinguishes materially visual/interactive work from incidental frontend-file changes and identifies the
  project's design basis.
- An approved frontend-owned FEATURE Plan dispatches to Frontend Engineer and preserves that owner through repair.
- The user can choose Pair or autonomous execution without rewriting or reopening the Plan.
- In Pair Execution, the user can complete at least two feedback/revision checkpoints without restarting the Plan, Agent
  context, execution worktree, dev server, or browser session.
- The user can switch remaining work to AFK at a checkpoint.
- Pair checkpoints are rendered as expected collaboration rather than failed or interrupted execution.
- Frontend Engineer verifies the final behavior in the real browser before Task Completion.
- Normal Workflow Validation still runs and Pair feedback is never presented as equivalent validation evidence.
- Projects without browser automation dependencies do not receive a new framework unless the Plan explicitly requires
  one.
- Existing autonomous and non-frontend Plan execution remains usable without new interaction ceremony.

## Risks and Mitigations

- **Agent prompt duplication:** Frontend Engineer and Engineer could drift on shared execution rules. Keep common
  invariants concise and synchronized while preserving distinct work styles.
- **Overclassification:** Planner may send routine frontend maintenance into Pair Execution. Base ownership on the
  primary product outcome and make pairing a recommendation the user can override.
- **Checkpoint fatigue:** Too many pauses would make Pair Execution slower than direct steering. Require coherent
  visible increments and always offer switch-to-AFK.
- **Plan drift:** Visual feedback can expand into product redesign. Preserve the approved objective and return material
  capability or information-architecture changes to planning.
- **Browser lifecycle failures:** Dev servers, ports, credentials, and remote dependencies can block the loop. Preserve
  the existing repair-first frontend preflight policy and report only genuinely external blockers.
- **Model visual limitations:** A text-only or weak-vision model may not judge screenshots reliably. Keep user judgment
  authoritative and support independent model configuration or Vision Fallback.
- **Client capability differences:** Headed local pairing may not translate to every headless or remote client. Fall
  back to autonomous execution rather than simulating Pair checkpoints without a shared visual surface.

## Out of Scope

- The deleted automated Manual QA validation gate and its `none | ask | always` policy.
- Treating Frontend Engineer as an autonomous aesthetic authority.
- Replacing Tester, Semantic Code Review, User Code Review, or Workflow Validation.
- Mandatory Playwright installation, generated end-to-end tests, or screenshot baselines for every frontend Plan.
- A new Plan Status solely for visual checkpoints.
- Full screenshot annotation, Figma synchronization, or an embedded design canvas in the first slice.
- Automatically converting exploratory Agent-browser actions into committed browser tests.
- Frontend QUICK_FIX routing in the first FEATURE-focused slice; it remains a follow-up after planned execution is
  proven.
- Redesigning the broader Routing Intent taxonomy.
