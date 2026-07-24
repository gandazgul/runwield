# Product Requirements Document: Attached Mode

Last updated: 2026-07-24 16:53 EDT

## Objective

Make RunWield's planning, verification, and organizational-memory workflow available inside the coding agent a user
already prefers, without making RunWield the user's default interface or model execution layer.

**Attached Mode** should let a user keep Claude Code, Codex, OpenCode, or Pi, explicitly invoke RunWield for one User
Request, and receive the deepest workflow that the External Agent Host can honestly support. Every LLM call remains
owned and made by the External Agent Host. RunWield remains authoritative for durable workflow truth: Plans, review,
Plan Lifecycle, execution isolation, validation outcomes, recovery evidence, Work Records, and organizational memory.

Attached Mode is both a low-friction acquisition surface and a durable first-class product mode. Users who never move to
Managed or Native experiences must still receive a complete, trustworthy product. Conversion should be earned through
stronger integration and convenience, not forced through deliberate feature withholding.

The three product promises are:

| Mode     | Promise                                                       |
| -------- | ------------------------------------------------------------- |
| Attached | Keep your agent. Add RunWield's planning and verification.    |
| Managed  | Use your preferred agent inside RunWield's complete workflow. |
| Native   | Use the fully integrated RunWield experience.                 |

## Problem Statement

RunWield currently provides an opinionated Plan-by-Default workflow through its own TUI, Workspace, Agent definitions,
and Pi-backed Session runtime. This delivers strong lifecycle and verification guarantees, but adopting a new harness is
a meaningful barrier for users and teams already working effectively in Claude Code, Codex, OpenCode, or Pi.

A prompt or Skill alone cannot provide RunWield's value. Instructions may encourage planning, but they do not own Plan
state, approval, worktree baselines, validation, merge-back, recovery, Work Records, or durable memory. Conversely,
running a hidden RunWield Agent behind a host slash command would preserve the host's interface but not the promise to
"keep your agent."

Attached Mode therefore needs a cooperative boundary:

- the External Agent Host owns the conversation, model access, and all Agent reasoning;
- RunWield supplies role prompts, Skills, deterministic workflow gates, durable artifacts, review surfaces, validation,
  recovery, and memory;
- the user explicitly activates this cooperation for one request;
- ordinary host use remains unchanged when no Attached Workflow is active.

The integration must reuse RunWield's existing domain authorities rather than implement a second host-specific Plan
Lifecycle. It must also distinguish truthful product parity from enforcement capabilities that a particular host does
not expose.

## Target Users

Attached Mode primarily serves:

- existing Claude Code users who want stronger planning, review, verification, recovery, and project memory without
  replacing Claude Code;
- existing Codex users with the same need after the Claude integration proves the shared contract;
- teams evaluating RunWield who want to begin within familiar tools before adopting Managed or Native experiences;
- users who prefer to remain permanently Attached and accept host-specific UX or enforcement limitations while keeping
  RunWield's verification semantics intact.

External Agent Host priority is:

1. Claude Code
2. Codex
3. OpenCode
4. Pi

This order is a product and distribution priority, not a judgment that later hosts have weaker extension APIs.

## Resolved Assumptions

### Per-Request Opt-In

- Installing Attached Mode must not alter ordinary External Agent Host behavior.
- A user explicitly starts one Attached Workflow for one User Request, conceptually through `/runwield <request>` or the
  closest host-native equivalent.
- RunWield prompts, restrictions, and lifecycle claims apply only within that Attached Workflow.
- The host returns to ordinary behavior after the workflow reaches an outcome.
- Existing RunWield closure and recovery choices govern an active workflow; Attached Mode does not introduce a separate
  partially governed lifecycle.

### Host-Owned Model Execution

- Every LLM call is made by the External Agent Host using the user's existing host model access.
- This includes Triage, planning, ideation, implementation, semantic review, repair, recording, and delegated worker
  calls.
- Attached Mode does not require separate RunWield model credentials or a RunWield account.
- RunWield may inject its Agent prompts and Skills or ask the host to create isolated workers, but it must not silently
  substitute a RunWield-owned Agent Session.

### RunWield-Owned Workflow Truth

RunWield remains the sole authority for:

- canonical Plan files and Plan Lifecycle transitions;
- approval and readiness decisions;
- Plan workflow ownership and recovery evidence;
- execution baselines, worktree registration, merge-back, and cleanup decisions;
- Mechanical Validation and Workflow Validation outcomes;
- canonical Work Records and their provenance;
- project memory and derived search/index state.

The External Agent Host submits requests, structured outcomes, completion evidence, and review results. Host prose or a
host-local task state cannot independently make a Plan Ready For Work, Implemented, or Verified.

### One Verification Meaning

- A Verified Plan means the same thing in Attached, Managed, and Native experiences.
- Attached Mode must not introduce host-specific "verified-ish" Plan statuses.
- If a host cannot satisfy a required invariant, RunWield must fail visibly, use an existing explicit fallback, or
  produce an existing non-verified outcome.
- Host capability differences belong in a disclosed compatibility matrix rather than weaker durable truth.

### Capability-Adaptive Integrations

- Each first-party adapter should use the strongest reliable host-native capabilities available.
- Claude Code may use true permission-mode controls, Skills, plugin hooks, MCP tools, subagents, and worktree hooks.
- Codex may use its Skills, plugins, MCP, subagents, and command hooks while respecting documented hook coverage gaps.
- OpenCode and Pi may use their deeper plugin or extension APIs without making those APIs prerequisites for the shared
  Attached contract.
- A shared product semantic may be implemented differently by each host. For example, the canonical RunWield Planning
  Gate may use a real host Plan mode where available and deterministic mutation blocking elsewhere.
- Unsupported capabilities must be surfaced before the workflow depends on them.

### Isolation-First Planned Execution

- Planned FEATURE execution remains isolated in a RunWield-owned worktree by default.
- The invoking host conversation may supervise a host-native implementation worker operating in that worktree.
- All worker model calls still come from the External Agent Host.
- QUICK_FIX retains its existing in-place, no-Plan behavior.
- When a host cannot support a safe worktree handoff, RunWield may use its existing explicit in-place consent path and
  must disclose the reduced recovery assurance.
- External hosts must not create an independent worktree lifecycle that competes with RunWield's registry, baseline,
  validation, or recovery state.

### Structured Evidence, Not Transcript Import

- Ordinary host conversations remain completely outside RunWield.
- During an Attached Workflow, RunWield persists only the explicit request, structured workflow outcomes, canonical
  artifacts, review decisions, worktree evidence, validation evidence, and derived Work Records or Memories needed for
  the workflow.
- RunWield does not copy or index the raw External Agent Host conversation transcript.
- Raw host conversations remain private working space. Organizational knowledge continues to come from explicit durable
  artifacts and synthesis rather than chat-history ingestion.

### Lazy Project Onboarding

- A user must be able to run the first Attached Workflow in an uninitialized trusted repository.
- Full `wld init` is not an entrance requirement.
- RunWield creates only the artifacts required by the invoked workflow and clearly previews material repo-local changes.
- Richer context and memory seeding remain available through a namespaced host action such as `/runwield:init`.
- Supporting actions may be namespaced under RunWield, but internal lifecycle transitions must not become a cluttered
  command suite.

### Local, On-Demand Core

- The first Attached release does not require an always-running daemon or Session Host.
- The host adapter may invoke local RunWield Core capabilities on demand.
- Durable artifacts, workflow ownership, checkpoints, and recovery evidence must allow safe continuation after process
  loss.
- A persistent local service may be added later for performance or cross-client continuity, but it is not part of the
  acquisition prerequisite.

### First-Class Product, Organic Conversion

- Attached Mode is a supported destination for users who never convert.
- Primary product outcomes are successful verified work, retained use, and trustworthy recovery.
- Movement to Managed or Native experiences is a secondary organic outcome.
- Upgrade messaging may explain genuine integration advantages but must not reserve otherwise feasible Attached
  capabilities solely to manufacture conversion pressure.

## Product Experience

### Installation and Inactive Use

The user installs the first-party adapter through the External Agent Host's normal extension mechanism. Installation
must establish or obtain compatible local RunWield Core dependencies without requiring separate model authentication.
Executable hooks and local Core access must be disclosed through the host's normal trust and permission experience.

After installation:

- normal host prompts behave exactly as they did before installation;
- RunWield does not inspect prompts, inject context, or block tools unless an Attached Workflow is active;
- RunWield-specific actions are discoverable through the host's normal command or Skill UI;
- uninstalling or disabling the adapter returns the host to its prior behavior without removing canonical project
  artifacts.

### Starting an Attached Workflow

The primary experience is conceptually:

```text
/runwield <request>
```

The exact spelling may adapt to host command conventions. Activation should:

1. identify the current trusted Project root;
2. preflight the host and local Core capabilities required for the request;
3. establish the association between the host request and one Attached Workflow;
4. supply the appropriate RunWield Triage role and tools to the host model;
5. leave unrelated host sessions and future ordinary prompts untouched.

A user can explicitly initialize richer project context through a namespaced action such as:

```text
/runwield:init
```

Initialization is optional and may occur before or after the first Attached Workflow.

### Claude FEATURE Preview Journey

The Claude Code Preview is complete only when a user can perform this bounded end-to-end journey:

1. Install the first-party Claude Code adapter and compatible local Core dependencies through one documented onboarding
   flow.
2. Start from a trusted but otherwise uninitialized Git repository.
3. Invoke RunWield for a FEATURE-sized User Request in an existing Claude Code conversation.
4. Have Claude perform RunWield Triage and enter the appropriate planning behavior without making implementation edits.
5. Have Claude produce a canonical RunWield Plan and submit it through Core-owned lifecycle operations.
6. Receive Plannotator Feedback, revise the Plan in the same user-facing flow, and resubmit it.
7. Approve the Plan through Plannotator and pass the normal Readiness Gate.
8. Create or reuse a RunWield-owned execution worktree and capture the execution baseline.
9. Have a Claude-hosted implementation worker complete the approved Plan in the worktree.
10. Run the configured local validation command and independent Claude-hosted Semantic Code Review.
11. Return blocking Review Issues to a Claude-hosted repair worker and independently re-verify repairs under the normal
    bounded convergence policy.
12. Complete optional human review when configured.
13. Merge validated work back through RunWield's existing worktree safeguards and record the Plan as Verified only after
    merge-back succeeds.
14. Generate the canonical Work Record and eligible memory outcome without importing the Claude transcript.
15. Cancel, restart, or lose either host or Core processes at supported checkpoints and recover without blind replay or
    silent lifecycle corruption.
16. Continue using the same Claude Code installation normally for requests that do not invoke RunWield.

### Review Experience

- Plannotator remains the rich Plan and code-review surface.
- Attached adapters should open or present the same review outcome rather than rebuild host-specific review products.
- Feedback and approval must return as structured workflow outcomes, not inferred from chat prose.
- The External Agent Host may summarize review progress, but RunWield remains the authority for the resulting lifecycle
  transition.

### Recovery Experience

- Process loss must preserve Plans, worktrees, baselines, leases/checkpoints, and other durable recovery evidence.
- RunWield must distinguish safe continuation from uncertain external side effects.
- Recovery must ask the user when a host command, filesystem change, merge, or validation action may have partially
  completed.
- Attached Mode does not promise exact continuation at an interrupted token or exactly-once replay of arbitrary host
  tool calls.

### Documentation and Positioning

- The README must position RunWield as the planning, verification, and organizational-memory layer for AI software
  development and explain Attached, Managed, and Native promises together.
- Attached must appear as a distinct installation mode, with current Preview or stable availability shown per External
  Agent Host.
- Host-specific guides must cover installation, `/runwield` activation, optional `/runwield:init`, review, permissions,
  local artifacts, privacy boundaries, recovery, updates, disablement, and uninstall.
- Documentation must distinguish available adapters from planned targets and must not imply parity based only on a
  host's listed APIs.
- Managed and Native comparisons may explain genuine workflow and UX advantages without suggesting that Attached is an
  intentionally incomplete trial.

## Technical Approach

### Host-Neutral Attached Coordination Boundary

RunWield Core needs an agent-neutral coordination boundary for Attached Workflows. It must expose workflow capabilities
without constructing or prompting RunWield's own Pi Agent Sessions.

This boundary is conceptually different from ACP:

- ACP makes an external application a client of a RunWield-executed Session.
- Attached Mode keeps the External Agent Host as the executor and asks Core to coordinate durable workflow truth.

The exact transport is an architectural choice. MCP, stdio commands, a local protocol, or a bounded combination may be
used, provided every host adapter consumes the same Core semantics and no adapter reimplements Plan Lifecycle or
validation authority.

### Decouple Workflow Authority From Model Invocation

Current end-to-end orchestration frequently invokes RunWield-owned Pi `AgentSession` instances and interprets protected
Pi tool results. Attached Mode requires the workflow engine to distinguish:

- deciding which role or workflow action is required;
- delivering the relevant prompt, Skill, context, and tool contract to an External Agent Host;
- accepting and validating a structured result from that host;
- recording durable Plan Events and continuing workflow orchestration.

Native and Managed execution may retain their appropriate model-invocation adapters. Attached adds an External Agent
Host adapter; it must not fork the domain state machine.

### First-Party Host Adapter Responsibilities

Each adapter may package host-native commands, Skills, Agent role prompts, subagents, hooks, and tool/MCP configuration.
It is responsible for:

- explicit activation and inactive no-op behavior;
- host Session identity and Project-root evidence needed to bind the request safely;
- injecting the current RunWield role contract without replacing unrelated host instructions;
- applying the Planning Gate and other deterministic restrictions while the Attached Workflow requires them;
- invoking Core operations and returning structured outcomes to the host model;
- creating fresh host-native workers for implementation, review, repair, or recording when role isolation matters;
- reporting host cancellation, completion, and tool evidence accurately;
- preserving host-native permission prompts and never loosening user or organization security policy;
- exposing compatibility diagnostics and a supported host-version range.

### Core Responsibilities

Core must provide reusable, host-neutral operations for:

- Triage outcome acceptance and workflow dispatch decisions;
- Plan creation/submission, review, readiness, lifecycle, and ownership;
- worktree preparation, baseline capture, registry state, validation, merge-back, and recovery;
- structured completion, review, repair, and recording contracts;
- Work Record and memory synthesis from canonical evidence;
- capability preflight and explicit fallback decisions;
- idempotent continuation after supported interruptions.

Core operations must validate current durable state rather than trust a host assertion blindly. A host calling a
completion action is evidence for orchestration, not permission to skip lifecycle guards.

### Planning Gate

The product-level Planning Gate means mutation is prohibited until the relevant workflow permits it. Implementations may
use:

- a true host Plan or read-only mode;
- deterministic pre-tool hooks that deny edit and mutating command paths;
- host-native permission profiles;
- post-turn working-tree inspection as defense in depth.

An adapter must not claim a hard gate if the host exposes unobservable mutation paths. Such limitations must be
preflighted and documented.

### Role Isolation

The invoking host conversation remains the user-facing coordinator. Fresh host-native workers should be used where
independence materially affects trust, particularly for:

- isolated implementation in the execution worktree;
- Semantic Code Review after implementation;
- independent re-verification after repairs;
- bounded recording or other synthesis that should not inherit the full conversation.

Where a host lacks worker isolation, the adapter must disclose the limitation and may not weaken Core's verification
requirements to compensate.

### Compatibility Matrix

RunWield must maintain a versioned capability matrix for every supported External Agent Host. At minimum it should state
support for:

- install/distribution;
- explicit invocation and namespaced actions;
- prompt/Skill injection;
- mutation gating and known unobservable tool paths;
- structured tools or MCP;
- worker/subagent isolation;
- worktree creation or handoff;
- review interactions;
- cancellation and recovery evidence;
- stable versus experimental host APIs.

Preview labels and verification claims must reflect tested capabilities rather than assumed API similarity.

## Release Strategy

### Stage 1: Claude Code FEATURE Preview

Ship an explicitly labeled Preview after the complete FEATURE journey succeeds end to end. The Preview must include
truthful capability documentation and must not imply full Routing Intent parity.

Lighter Routing Intents may be included when they satisfy their normal semantics, but breadth must not delay proving the
FEATURE lifecycle.

### Stage 2: Stable Claude Attached

Claude Attached becomes stable only when:

- every canonical Routing Intent is supported or explicitly proven irrelevant to Attached Mode;
- lifecycle, review, isolation, validation, recovery, Work Record, and memory behavior meet the shared RunWield
  semantics;
- supported Claude Code versions pass repeatable black-box integration coverage;
- upgrade, disable, uninstall, and stale-workflow recovery behavior are documented and tested.

### Stage 3: Additional External Agent Hosts

Add adapters sequentially:

1. Codex
2. OpenCode
3. Pi

Each adapter begins with a capability-disclosed Preview and reaches stable status only after meeting the same applicable
product semantics. Later adapters must reuse the host-neutral Core contract rather than copy the Claude implementation.

## Success Criteria

### Preview Acceptance

- A user can install Claude Attached without configuring a second model provider or RunWield account.
- A normal Claude Code request made after installation but outside `/runwield` receives no RunWield prompt injection,
  restriction, or workflow state.
- A first `/runwield` FEATURE request works in an uninitialized trusted Git repository.
- No LLM call in the journey is made outside Claude Code.
- Plan review and Feedback use canonical RunWield artifacts and Plannotator.
- Implementation occurs in a RunWield-owned worktree and does not begin before approval and readiness.
- Workflow Validation uses the normal configured CI, semantic review, repair, optional human review, and merge-back
  semantics.
- The Plan becomes Verified only after all existing verification requirements pass.
- A Work Record is produced from structured evidence without copying the Claude transcript.
- At least one interrupted planning/review checkpoint and one interrupted execution/validation checkpoint recover safely
  in black-box tests.
- Disabling Attached Mode leaves canonical Plans, Work Records, and recovery evidence intact while restoring ordinary
  host behavior.

### Stable Product Outcomes

Measure:

- successful installation and capability preflight rate;
- first Attached Workflow activation rate;
- time from installation to first reviewed Plan and first Verified Plan;
- Attached Workflow completion, failure, cancellation, and recovery rates;
- percentage of planned workflows that preserve worktree isolation;
- validation and semantic-review convergence outcomes;
- retained Attached use across Projects and time;
- frequency and cause of host-capability fallbacks;
- voluntary progression to Managed or Native experiences as a secondary metric.

Metrics must be privacy-safe and must not contain raw prompts, host transcripts, source content, secrets, or sensitive
paths. Conversion must not be optimized by reducing Attached capability.

## Risks and Mitigations

### Host API Churn

Plugin, hook, permission, worker, and worktree APIs may change independently. Maintain pinned compatibility ranges,
black-box adapter tests, explicit Preview labels, and fast-failing preflight diagnostics.

### False Enforcement Claims

Some hosts expose tool paths that hooks cannot observe. Use capability-specific gates, baseline and working-tree checks,
and fail visibly when an invariant cannot be proven. Do not equate a prompt instruction with enforcement.

### Split-Brain Workflow State

The host and Core may both appear to track plans or completion. Core must remain the sole Plan Lifecycle authority, with
Plan Workflow Leases and durable checkpoints preventing competing sessions or adapters from advancing the same Plan.

### Untrusted Host Assertions

A model may claim it planned, completed, repaired, or reviewed work without sufficient evidence. Core must validate
artifacts, lifecycle state, diffs, CI results, review-result consistency, and merge outcomes before recording durable
transitions.

### Worktree Handoff Failure

The parent host conversation may not be able to move safely into a RunWield worktree. Prefer host-native isolated
workers and tested worktree hooks. Use explicit in-place consent only when supported by existing Core semantics and
disclose the recovery trade-off.

### Permission and Trust Friction

Adapters contain executable local code. Use host-native install and trust review, disclose local Core access, keep hooks
inert outside Attached Workflows, never auto-loosen host permissions, and make disable/uninstall behavior clear.

### Workflow Deadlock

A host turn, browser review, local Core process, or worker may wait indefinitely for another surface. Persist pending
workflow state, surface the current waiting reason, support cancellation, and recover from stale interactions without
assuming side effects did or did not occur.

### Host Quota and Cost

Independent planning, implementation, review, repair, and recording roles consume the user's host quota. Use context
parsimony, bounded retries, and clear progress reporting. Do not hide the fact that stronger verification may require
multiple host model calls.

### Mode Confusion

Users may interpret Attached as RunWield secretly taking over Claude Code or as a weaker verification tier.
Documentation must consistently explain who makes model calls, when RunWield is active, which system owns workflow
truth, and why Managed or Native may offer a smoother experience without changing Verified semantics.

## External Feasibility Evidence

Current official host documentation supports the product direction while confirming capability differences:

- [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks-guide) can inject context, block tool use,
  continue stopped turns, participate in permission decisions, and package through plugins or active Skills. Hook
  denials can tighten policy even under permissive host modes.
- [Claude Code Skills](https://docs.anthropic.com/en/docs/skills),
  [plugins](https://docs.anthropic.com/en/docs/plugins), and [subagents](https://docs.anthropic.com/en/docs/sub-agents)
  provide first-party distribution and host-owned role or worker surfaces.
- [Codex customization](https://developers.openai.com/codex/customization/overview) supports Skills, plugins, MCP, and
  subagents. [Codex hooks](https://developers.openai.com/codex/hooks) can inject context and intercept many local tools,
  but official documentation warns that specialized paths may not use the default hook path.
- [OpenCode plugins](https://opencode.ai/docs/plugins/) provide event hooks, custom tools, SDK access, and npm or local
  distribution.
- [Pi extensions](https://pi.dev/docs/latest/extensions) and [Pi packages](https://pi.dev/docs/latest/packages) provide
  broad command, tool, event, UI, and package extension surfaces.

These are feasibility facts, not a guarantee of parity. Every supported host/version combination still requires tested
capability evidence.

## Out of Scope

- Replacing the External Agent Host's model, authentication, billing, or ordinary conversation experience.
- Running RunWield-owned LLM calls during an Attached Workflow.
- Passive inspection or governance of host requests that do not explicitly invoke RunWield.
- Importing raw Claude Code, Codex, OpenCode, or Pi conversation transcripts.
- Creating a weaker Attached-specific Plan Lifecycle or verification status.
- Rebuilding Plannotator review interactions independently inside every host.
- Requiring an always-running daemon or Session Host for the first release.
- Promising exactly-once replay of arbitrary interrupted host commands, model turns, or filesystem side effects.
- Tamper-proof enterprise enforcement when users or administrators can disable the adapter or its hooks.
- Shipping shallow simultaneous adapters for all External Agent Hosts before the Claude FEATURE vertical slice works.
- Withholding otherwise feasible Attached capabilities solely to encourage Managed or Native conversion.
- Replacing External Work Sources or adding ticket lifecycle synchronization.

## Open Engineering Questions

These questions are intentionally deferred to Architecture and implementation planning because they do not change the
resolved product direction:

- Which transport or combination of transports should expose the host-neutral Attached coordination boundary?
- Which existing workflow services can become agent-neutral directly, and which need a model-invocation adapter seam?
- How should host Session identity map to Attached Workflow ownership without importing the host transcript?
- How should each host enter, supervise, and recover a RunWield-owned worktree worker?
- What structured contracts should carry Triage, completion, semantic review, repair, and recorder results?
- How should one host-native installation acquire, version, update, diagnose, and remove compatible local Core
  dependencies?
- Which host versions and experimental capabilities define each adapter's initial compatibility range?
