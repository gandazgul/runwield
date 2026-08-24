---
planId: "d9fa56fe-1ff7-4508-a29a-231cb5a6375e"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Finish injection-seam ownership enforcement: declare the genuine external ports by name, reject required ports that expose RunWield-owned machinery, and split the mixed-ownership ValidationSessionPort."
affectedPaths:
    - "AGENTS.md"
    - "docs/domain-language.md"
    - "docs/plans/deep-semantic-source-modules.md"
    - "docs/plans/flag-test-seam-risks-during-init.md"
    - "docs/plans/finish-injection-seam-ownership-enforcement.md"
    - "scripts/check-injection-seams.js"
    - "scripts/check-injection-seams.test.js"
    - "scripts/external-capability-ports.json"
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/shared/extensions/wld-extension-manifest.js"
    - "src/shared/package-resources.js"
    - "src/shared/session/architecture-boundary.test.js"
    - "src/shared/workflow/architecture-boundary.test.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/validation-completion-gating.test.ts"
    - "src/shared/workflow/validation-context.ts"
    - "src/shared/workflow/validation-emit.ts"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-human-review.ts"
    - "src/shared/workflow/validation-interactions.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-test-helpers.js"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-loop-*.test.js"
    - "src/ui/tui/interactive-session-port.ts"
createdAt: "2026-07-30T17:54:11.445Z"
updatedAt: "2026-08-18T12:00:00-0400"
status: "draft"
origin: "user"
---

# Finish injection-seam ownership enforcement

## Context

The original migration is complete. RunWield moved from 155 detected seams across 13 modules to a zero-seam baseline:

- `scripts/check-injection-seams.js` runs in `deno task ci` as `seams:check`;
- `scripts/injection-seam-baseline.json` contains no module entries;
- production command, workflow, session, Work Record, Workspace, and TUI tests use real RunWield machinery over isolated
  projects, repositories, Plans, SQLite stores, and home directories;
- only genuine external work such as Git/subprocess calls, Agent/model turns, browser launch, CI, clocks, network, and
  Mnemosyne uses fakeable ports;
- the bundled `write-tests` skill and Agent prompts state the ownership rule directly.

As of 2026-08-18, the ratchet scans production modules under both `src/` and `scripts/`. Expanding it to `scripts/`
exposed seven old optional fallback bags. They were removed without adopting a baseline: script entrypoints now provide
required environment/process ports, and the Router golden-set script calls the canonical triage parser directly.

The migration fixed defects that the old `__deps` shape concealed. Validation tests had disabled lifecycle journals,
locks, compare-and-set checks, and rollback. Workflow Slicer tests had bypassed the catalog lock and the decomposition
transaction. Some tests used the developer checkout as their project root and wrote live `.wld` state. These failures
are now covered through real fixture machinery.

The zero result is necessary, but it is not a full ownership proof. The detector still treats a required imported type
whose name ends in `Port` as safe. Its own source says required constructor injection is the desired replacement shape.
That rule is too broad: making an internal collaborator required removes the silent fallback, but it still lets tests
replace machinery that RunWield owns.

## Remaining live gaps

The expanded audit found that the remaining problem is no longer accurately described as “replace dependency bags.” The
optional bags are gone from the enforced roots. What remains is ownership enforcement for required ports: a required
object can still let tests replace RunWield machinery if the detector trusts the `Port` suffix.

Confirmed mixed or internal ports that the current zero count does not reject:

- `ExecutionStartPorts` exposes Worktree lookup, branch policy, canonical Plan loading, settings consent, and metric
  recording. Keep the real functions and use fixture repositories, Plans, settings homes, and metric files. Retain
  narrow ports only for the actual Git/subprocess, user-interaction, and clock boundaries.
- `RecoveryFlowPorts` combines the genuine Git boundary with RunWield-owned workflow metric storage. Import metric
  recording directly and exercise it over a fixture project home.
- `InteractiveSessionPort` makes RunWield's own interactive-session startup replaceable by command tests. Commands
  should exercise the real session composition with fake external Agent/browser/terminal capabilities.
- `resolveInstalledPackagePromptResources` and `resolveInstalledWldExtensionResources` retain
  `settingsManager || getSettingsManager()` fallbacks. Remove the settings override and use isolated fixture homes.
- `ValidationSessionPort` remains the largest mixed-ownership port and is detailed below.

### `ValidationSessionPort`

The session-independent Workflow Validation extraction introduced
`src/shared/workflow/validation-ports.ts#ValidationSessionPort`. It is a required engine argument, so the current
detector reports zero seams. It has 16 members with mixed ownership:

| Ownership                                 | Current members                                                                                | Required outcome                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| RunWield workflow state                   | `getActiveWorkflow`, `setActiveWorkflow`                                                       | Keep behind real Runtime state machinery. Tests observe the resulting workflow state; they do not implement these methods.       |
| RunWield validation state                 | `getPosition`, `rememberPosition`, `clearPosition`, `getCurrentProgress`, `setCurrentProgress` | Keep as engine/runtime-owned state. `setCurrentProgress` currently has no caller and is removed.                                 |
| RunWield event and cancellation machinery | `emitStatus`, `registerActiveInteraction`, `unregisterActiveInteraction`                       | Use the real Runtime event and active-interaction paths. Tests attach fixture consumers to real `HostedSession` objects.         |
| Genuine external user boundary            | `requestInteraction`                                                                           | Move to a narrow required interaction port.                                                                                      |
| Genuine external Agent/Pi boundary        | `runIndependentRepairTurn`, `createInMemorySessionManager`, `runIsolatedAgentSession`          | Move to a narrow required Agent-session port. This owns Pi handles and message translation.                                      |
| RunWield registry machinery               | `getAgentDisplayName`                                                                          | Import and call the canonical Agent registry directly.                                                                           |
| RunWield completion machinery             | `runPostVerificationHandoffs`                                                                  | Call the canonical Manual QA and Work Record handoff machinery directly. Only the actual external sub-capabilities remain ports. |

The current adapter also has an optional external override:

```ts
createValidationSessionPort(hostedSession, { semanticReviewPort } = {});
const isolatedSessions = semanticReviewPort || SYSTEM_SEMANTIC_REVIEW_PORT;
```

The public `ValidationLoopArgs` repeats `semanticReviewPort?: SemanticReviewPort`. Production callers already pass
`SYSTEM_SEMANTIC_REVIEW_PORT`, while validation tests pass an explicit fake such as `NO_ISOLATED_AGENT_PORT`. The
fallback is therefore unnecessary. It must become a required external capability at the composition root.

`ValidationSessionPort` did deliver one valid architectural result: validation sequencing and phase policy do not import
HostedSession or Pi directly. This Plan preserves that result. It removes the replaceable machinery aggregate; it does
not couple phase modules back to Pi.

## Objective

Make ownership, not parameter syntax, decide what can be replaced:

- retain the zero optional-seam baseline;
- reject required ports and constructor arguments when they expose RunWield-owned behavioral machinery;
- replace `ValidationSessionPort` with narrow required ports for only Agent/Pi execution and user interaction;
- keep workflow state, position, progress, Runtime events, cancellation registration, display-name lookup, and
  post-verification handoffs on real RunWield code paths;
- preserve the session-independent validation engine for both Core Session execution and the future
  `AttachedWorkflowCoordinator`;
- keep every validation test isolated from the real checkout, Plans, settings, `~/.wld`, browser, LLM, and Mnemosyne
  data.

## Ownership rules

An injection seam is a public claim that a behavior is outside the product boundary.

- **External or independently operated capability:** Git, subprocess, network, browser, Agent/model call, Pi's low-level
  session/JSONL facility, hosted CI, clock, Mnemosyne. Use a small required port with no fallback.
- **RunWield-owned machinery:** Plan writes, lifecycle transitions, validation state, workflow state, registries,
  Runtime events, transactions, locks, Work Record generation, and orchestration. Do not expose a replaceable
  collaborator. Exercise the real implementation through a fixture environment.
- **Data and policy input:** paths, ids, parsed settings, limits, and immutable request data are ordinary parameters,
  not ports.
- **Internal architecture boundary:** an interface between two RunWield modules does not become an external capability
  because two runtime variants use it. If a module needs a RunWield-owned context, use a nominal, product-constructed
  context that cannot be implemented with a test object.

Ports are behavioral capabilities, not one injected function per call site. A missing port is a type error. No callee
selects a system implementation with `||`, `??`, a default parameter, an optional property, or a test-only branch.

## RunWield-internal named external ports

This is repository-specific enforcement for RunWield's JavaScript and TypeScript source. It is not a format installed in
customer projects and is not part of the `wld` product contract.

Do not infer ownership from a suffix or a broad verb list. Maintain `scripts/external-capability-ports.json` as
RunWield's small, reviewed declaration of production behavior RunWield does not own. Each entry names:

- the exact exported Port type;
- its source module;
- the external system it represents, such as Git, browser, Pi/Agent execution, CI, clock, network, GitHub CLI, or
  Mnemosyne;
- the capability members that may be implemented by tests.

The seam detector resolves required Port types and accepts them only when that exact type/module/member set is declared.
Changing a port's members therefore requires an explicit architectural change to the manifest. A `Port`, `Deps`,
`Hooks`, or constructor argument absent from the manifest receives normal machinery analysis; naming something
`ExternalPort` is not an escape hatch.

Keep the manifest about ownership, not implementations. It must not list `SYSTEM_*` objects, test fakes, convenience
wrappers, or RunWield module boundaries. In particular, Plan storage, Worktree registries, settings, metrics, Runtime
events, interactive-session startup, and validation state can never appear in it.

Do not expose this manifest, its `path#exportedType` identity, the `Port` naming convention, the `src/` and `scripts/`
roots, Deno tasks, or the seam detector through `wld init` or `wld check`. Customer repositories may use different
languages, build systems, source layouts, and dependency-boundary idioms. The separate language-neutral project-checks
Plan may export the general practice, but never this repository's implementation.

## Validation design

### 1. Narrow external ports

Replace the external members of `ValidationSessionPort` with two required contracts:

- `ValidationAgentPort` owns completion-gated repair turns, isolated Reviewer and Reviewer-Feedback Engineer turns,
  in-memory Pi session-manager handles, Pi message translation, and external execution failures;
- `ValidationInteractionPort` owns user decisions and interaction cancellation as seen by the external presentation
  boundary.

The Core Session composition root binds both ports to the real HostedSession/Pi implementation. Attached Mode will bind
the same semantic contracts to its External Agent Host. Neither port owns Plan state, workflow state, progress, Work
Records, or lifecycle transitions.

`SemanticReviewPort` is folded into `ValidationAgentPort`. The public validation entry requires the resulting Agent
port; there is no `SYSTEM_*` fallback inside `validation.ts` or `validation-session-adapter.ts`.

### 2. Non-replaceable RunWield runtime context

Create one product-owned `ValidationRuntimeContext` for the state that must remain session-independent but real. It is
not a port:

- its constructor and implementation details are private to validation composition;
- it has a nominal runtime brand, and the engine rejects plain structural lookalikes;
- the Core Session factory requires a real `HostedSession`;
- tests obtain it only by constructing a real fixture HostedSession through the same factory;
- phase modules do not accept callbacks or object literals for workflow state, position, progress, Runtime event
  emission, or active-interaction registration;
- only approved Core Session and future Attached composition modules can create it; an architecture test rejects other
  construction and direct engine invocation.

The context is an internal run handle, not an ownership exception and not an entry in the future external-capability
manifest. Its methods delegate to canonical RunWield modules. It must not duplicate lifecycle or persistence logic.

Where state can move into the engine without a callback, prefer engine-owned data:

- remove unused `setCurrentProgress`;
- hold the current progress record in the validation run and emit it through the real Runtime event machinery;
- keep phase position and active workflow updates authoritative across pause/resume; do not derive them from display
  projections or fake stores.

### 3. Direct RunWield machinery

Phase code imports the canonical Agent display-name registry directly. Publication calls the canonical post-verification
handoff function directly. If these functions need Runtime presentation or an external operation, they receive the
non-replaceable runtime context and the already declared external port. No new wrapper interface is introduced for
testability.

## Current files and reuse

- `src/shared/workflow/validation.ts` is the public Core Session composition root. It currently builds
  `ValidationSessionPort` and rebinds Local CI over the real HostedSession.
- `src/shared/workflow/validation-session-adapter.ts` is the only validation module coupled to HostedSession and Pi. It
  currently owns the optional `SemanticReviewPort` fallback and all mixed port methods.
- `src/shared/workflow/validation-ports.ts` owns the current 16-member contract plus its engine-facing types.
- `src/shared/workflow/validation-test-helpers.js` already provides real Plan roots and HostedSession recorders. It also
  provides explicit fakes only for Git, CI, Mnemosyne, and Agent calls.
- `src/shared/workflow/validation-completion-gating.test.ts` already proves independent repair sessions through a real
  HostedSession and proves private session-manager reuse after an external backend failure.
- `src/shared/git-test-fixture.ts#defineGitFixture` and
  `src/shared/workflow/validation-test-helpers.js#makeValidationProjectRoot` remain the standard fixtures.
- `src/shared/session/architecture-boundary.test.js` already restricts session/Pi imports. Extend it to restrict runtime
  context construction and direct engine use.

## Implementation steps

- [x] **Freeze and ratchet the original problem.** `seams:check` is part of CI. The baseline is now zero modules and
      zero seams; `--update` cannot be used to adopt a new seam.
- [x] **Remove dependency bags and machinery overrides.** The original 51-module migration is complete. Plan, lifecycle,
      transaction, registry, lock, Work Record, Workspace, SessionRuntime, command, and TUI machinery runs through real
      fixture environments.
- [x] **Create genuine external capability ports.** Git, Agent/model, CI, browser, network, process, clock, GitHub CLI,
      and Mnemosyne boundaries are explicit at production composition roots and explicit in tests.
- [x] **Scan production scripts.** The ratchet now walks both `src/` and `scripts/`, excludes tests and fixtures, and
      pins this coverage in `check-injection-seams.test.js`. Seven newly visible optional bags were removed without a
      baseline entry.
- [ ] **Declare named external ports.** Add `scripts/external-capability-ports.json` with the exact approved type,
      module, external owner, and member names. Validate the manifest itself and reject stale declarations.
- [ ] **Make the detector ownership-aware for required ports.** Change the rule that automatically exempts required
      imported `*Port` types. Accept only exact declarations from the named external-port manifest. Add positive cases
      for `ValidationSessionPort`, `ExecutionStartPorts`, `RecoveryFlowPorts.recordWorkflowMetric`, and
      `InteractiveSessionPort`; add negative cases for declared external ports and ordinary data parameters. The
      detector must go red on the current ports before their production refactors make it green.
- [ ] **Remove the other required machinery ports.** Exercise execution start and recovery through real Git/Plan/home
      fixtures, call workflow metrics directly, and make command tests enter real interactive-session composition while
      faking only the external Agent/browser/terminal capabilities.
- [ ] **Remove internal settings overrides.** Make package and WLD-extension discovery read the real settings manager
      from fixture homes; remove both optional `settingsManager` fallbacks and their `any` annotations.
- [ ] **Split `ValidationSessionPort` by ownership.** Introduce the narrow required `ValidationAgentPort` and
      `ValidationInteractionPort`; move no RunWield-owned member into either. Remove `ValidationSessionPort` completely.
- [ ] **Remove the Agent-session fallback.** Make the Agent port required in `ValidationLoopArgs` and the Core Session
      adapter. Update every production caller to compose the system implementation and every test to pass an explicit
      external fake only when the scenario reaches an Agent boundary.
- [ ] **Move internal state to real machinery.** Add the nominal `ValidationRuntimeContext`, remove unused progress
      mutation, and route workflow state, phase position, progress, events, cancellation, registry lookup, and
      post-verification handoffs through canonical RunWield implementations.
- [ ] **Rewrite tests through public validation behavior.** Keep existing validation-loop behavior counts. Replace any
      direct port-object construction with real HostedSession, Plan, Git, and Runtime fixtures. Retain loud fakes for
      Agent/model, CI, browser, and Mnemosyne boundaries. Add a focused runtime-context suite and mutation proof for
      each removed internal replacement point.
- [ ] **Align downstream architecture documents.** Update `docs/domain-language.md` so it no longer defines the engine
      by `ValidationSessionPort`. Update `deep-semantic-source-modules.md` so it moves the new context and narrow ports,
      not the old 16-member aggregate. Update `flag-test-seam-risks-during-init.md` so public guidance explains the
      ownership rule without exporting either RunWield type as a customer-facing capability declaration.
- [ ] **Keep advisory Init guidance separate.** Coordinate with `flag-test-seam-risks-during-init.md`, which may teach
      the ownership rule and surface possible issues but must not ship this detector, manifest schema, source globs,
      Port naming, RunWield CI wiring, or an automated cross-language verdict to customer repositories.

## Sequencing

Do not execute this Plan concurrently with `deep-semantic-source-modules.md`.

Preferred order:

1. complete this focused validation ownership refactor at the current paths;
2. revise the ready source-tree Plan's file map and checks to move the resulting context and narrow ports;
3. execute the source-tree move;
4. execute `flag-test-seam-risks-during-init.md` independently; it must not consume these internal paths.

If the source-tree move lands first, translate every current path in this Plan to `src/core/execution/validation/` and
perform the same behavior change there. Do not use the move Plan's pre-existing-port allowlist to waive
`ValidationSessionPort`.

## Verification plan

- Run OC1 through OC6 from Front Matter.
- Run `deno task seams:check`; it must report zero after the refactor without an adopted baseline entry.
- Run all validation-loop, completion-gating, validation-progress, validation-position, architecture-boundary,
  SessionRuntime, orchestrator, and epic-continuation suites through `scripts/run-tests.js`.
- Run full `deno task ci` through the isolated test runner.
- Run the complete validation test set twice concurrently. Both runs must use sandboxed HOME, temporary project roots,
  and separate fixture Plans without lock or journal contention.
- Mutation proof:
  - replace the nominal Runtime context with a plain object and confirm the architecture/runtime-context test fails;
  - restore `semanticReviewPort?:` plus its system fallback and confirm `seams:check` fails;
  - move `setActiveWorkflow` or `runPostVerificationHandoffs` onto an external port and confirm the ownership test
    fails;
  - break one real Git contract call and confirm a Git contract test fails;
  - remove one Agent fake from a scenario that reaches Semantic Review and confirm the test fails loudly instead of
    calling a real model.
- Confirm no test creates or changes files in the real checkout `.wld`, real Plan directories, real settings, or
  `~/.wld`, and no test opens a browser or calls a real LLM or Mnemosyne database.

## Preserved behavior

- Workflow Validation keeps the same phase order, lifecycle transitions, repair limits, pause/resume behavior, review
  convergence, human review, publication, progress events, Manual QA, and Work Record outcomes.
- The engine remains independent of Pi and HostedSession implementation types. Only composition and the external Agent
  adapter import them.
- Native and Managed Session behavior remains unchanged.
- The future Attached coordinator consumes the same validation engine and supplies only its real external Agent and user
  interaction capabilities. It does not implement RunWield workflow or validation machinery as fakes.
- No existing test is deleted because its setup depended on the old aggregate. Rewrite it against real machinery and
  account for every changed test.

## Edge cases and constraints

- A required parameter is not automatically a valid port. Required syntax removes fallback ambiguity; it does not prove
  external ownership.
- A nominal internal context must not become a service locator. It contains only one validation run's state and Runtime
  bindings, and it cannot expose Plan store, registry, lifecycle, or lock implementations for callers to replace.
- Attached Mode is a second composition root, not evidence that RunWield-owned validation state is external.
- Pi session management is external at the low-level package boundary. RunWield's policy for when and how to run a
  Reviewer or repair Agent remains engine-owned.
- A port aggregate is valid only when all members belong to one external capability. A mixed `ports`, `deps`, or
  `context` object is still a dependency bag under a different name.
- Pure formatters and data transforms need no port.
