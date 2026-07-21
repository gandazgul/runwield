# Handoff: RunWield Workspace Agent Sessions and Web IDE Direction

**Created:** 2026-07-20 09:56 EDT\
**Status:** Product discovery in progress\
**Owner:** RunWield Ideator

## Purpose

Continue product discovery for expanding RunWield Workspace from a project-scoped Plan board into the primary browser
environment for working the RunWield way: registering Projects, collaborating with Agent Sessions, managing Plans and
Work Records, searching code and planning history, and optionally opening a full browser IDE.

This handoff captures the decisions and research from the current session. Do not treat it as an implementation Plan.

## Core Product Direction

RunWield Workspace should become the primary workflow and collaboration interface. It should support two deployment
modes with the same conceptual product model:

1. **Local/self-hosted first:** `wld` runs a persistent local Project Runtime that an authenticated browser can reach
   remotely.
2. **SaaS later:** the same Project Runtime runs inside an isolated container managed by RunWield Workspace.

The current priority is local/self-hosted mode.

### Canonical language

The user initially described registering “workspaces,” meaning project directories. `CONTEXT.md` already defines
**Workspace** as the broader RunWield browser space. Use **Project** for a registered trusted project root.

A Project may:

- already be initialized for RunWield; or
- be registered and then initialized through Workspace.

## Resolved Product Decisions

- **Workspace is the primary shell.** Plans, workflows, Agent Sessions, Work Records, and retrieval define the main UX.
- **Code-server is a second-class Code surface.** Users open it when they want to inspect or modify code manually. It
  must not own Plan Lifecycle, workflow status, or RunWield worktrees.
- **Do not rebuild VS Code.** Reuse a maintained browser IDE rather than implementing language servers, extensions,
  terminals, debugging, source control, and editor state inside Workspace.
- **Use semantic Runtime events for Workspace chat.** The main Agent Session surface should render `SessionRuntime`
  messages, tools, interactions, attention, cancellation, validation, and Plan Recovery—not terminal bytes.
- **WebTUI is optional/advanced only.** It may later provide a raw terminal view, but it is not the strategic Agent
  Session UI.
- **CAW is inspiration, not a foundation.** Its pane layout, mobile considerations, notifications, and agent-state
  visibility are useful references, but its generic agent-manager and worktree ownership conflict with RunWield.
- **HumanLayer is a strong interaction reference.** Borrow its persistent work navigator, central semantic session
  timeline, context/artifact rail, and command-oriented navigation without adopting its generic Task domain model.
- **Preserve the RunWield design system.** Do not copy HumanLayer's terminal visual identity. New Workspace surfaces
  should follow `docs/design-system.md` and existing Workspace/Plannotator patterns.
- **ACP remains valuable.** The OpenAB/Telegram work hardens session identity, interactions, cancellation, and recovery.
  Telegram should become a secondary continuation/notification channel rather than the primary product experience.

## Proposed Product Shape

```text
RunWield Workspace
├── Projects
│   ├── Project health and RunWield initialization
│   ├── Plans and Epics
│   ├── Agent Sessions
│   ├── PRDs and ADRs
│   ├── Work Records
│   ├── code and planning search
│   └── Code (code-server)
├── cross-project Work Record and artifact retrieval
└── authentication, notifications, and remote access

Project Runtime
├── trusted project root
├── SessionRuntime and Agent Sessions
├── Plan Lifecycle and RunWield-owned worktrees
├── Cymbal/code search
├── Git, validation, and Plan Recovery
└── optional code-server process
```

Local and SaaS modes should preserve this conceptual boundary. Local mode points the Project Runtime at a trusted local
root; SaaS mode mounts or clones the Project into an isolated container.

## HumanLayer UI Reference

The supplied screenshot shows a useful three-pane model:

- **Left:** tasks and child sessions;
- **Center:** selected session timeline and composer;
- **Right:** artifacts/minimap/summary;
- **Top:** work breadcrumb and machine/project identity;
- **Bottom:** Agent/model/context status and keyboard navigation.

HumanLayer's official product documentation confirms that its Tasks group Agent Sessions, artifacts, and worktrees, and
that local/cloud daemons connect to the same browser UI.

A RunWield adaptation should be domain-specific:

### Left navigation

- Project switcher;
- Active Plans grouped by product-facing lifecycle state;
- associated Agent Sessions under each Plan;
- standalone Ideas & Sessions;
- On-Hold and Verified Plans;
- Work Records.

### Center workflow surface

- selected Plan or standalone Agent Session;
- semantic Agent timeline;
- structured interviews and approvals;
- Plan review and revision;
- execution and Workflow Validation;
- cancellation, attention, and Plan Recovery;
- workflow-aware composer.

### Right context rail

Possible contextual tabs:

- current Plan and lifecycle summary;
- related artifacts such as PRDs, ADRs, and research;
- relevant Work Records;
- affected files, changes, and worktree state;
- session/workflow outline.

The Plan must not be buried as one generic artifact. For planned work, it owns the workflow.

### Responsive behavior

The dense three-pane desktop layout should collapse side rails into drawers or focused views on mobile. Remote
continuation is a primary goal, so mobile cannot be an afterthought.

## Code Surface Boundary

The Code surface should open code-server against the Project's main checkout. Planned Agent execution remains isolated
in RunWield-owned Plan worktrees; users inspect those changes through Workspace, Guided Review, or Plannotator rather
than editing the Agent worktree through code-server.

Manual main-checkout changes and commits remain the developer's responsibility. Workspace must not silently incorporate
them into active Plan worktrees or attribute them to an Agent. Main-checkout changes may instead make active Plans stale
or create later merge conflicts, which RunWield must detect through its normal lifecycle and integration checks.

Search results can deep-link to the matching file and location in the main-checkout Code surface when that projection is
valid. Plan-worktree-only changes should open in Workspace review rather than pretending the same content already exists
in the main checkout.

## Authentication and Trust Boundary

The current local Workspace's random launch token and loopback binding are suitable for an ephemeral one-project Plan
UI, not a persistent remotely reachable Project Runtime.

The future strong-authentication contract needs to cover:

- TLS-only remote access;
- durable user authentication, likely passkeys and/or external OIDC;
- short-lived browser sessions and revocation;
- WebSocket authorization;
- CSRF and Origin enforcement;
- explicit trusted Project roots;
- no filesystem access outside registered Projects;
- separate authorization for execution, terminal, and destructive actions;
- audit visibility for consequential actions.

An identity-aware reverse proxy or private network may simplify the first single-user deployment, but Project Runtime
must still enforce trusted-root and session boundaries itself.

## External Research Findings

### CAW

Source: <https://github.com/04mg/caw>

- MIT-licensed Go/React browser terminal multiplexer.
- Launches multiple CLI agents in PTYs and owns parallel worktrees.
- Includes file browsing, Monaco, push notifications, quota monitoring, and a status board.
- Very early at the time of research: version `0.1.6`, 17 GitHub stars, one visible contributor.
- Current source defaults to localhost but exposes broad terminal and filesystem APIs without visible authentication
  middleware; changing `HOST` can expose the service.
- PTYs die with the CAW process; persisted metadata is used to relaunch agents with their resume flags.

Conclusion: borrow interaction ideas only. Do not embed or fork CAW as RunWield Workspace.

### `@plannotator/webtui`

Sources:

- <https://www.npmjs.com/package/@plannotator/webtui>
- <https://github.com/plannotator/webtui>
- vendored Plannotator ADR and implementation notes under `third_party/plannotator/adr/`

- MIT package, version `0.1.0` during research.
- Provides xterm rendering, React components, agent launch plans, message injection, and a `node-pty` WebSocket backend.
- Requires Node 20+ and native `node-pty`; Plannotator's Bun integration needs a Node sidecar.
- Plannotator disables remote terminal mode by default and requires explicit opt-in.
- It transports terminal bytes rather than RunWield semantic workflow events.
- Existing Plannotator use is narrow: one optional annotate-mode terminal, no terminal persistence, and no Plan review
  integration.

Conclusion: possible future raw-terminal component, not the primary Workspace Agent Session surface.

### Browser IDE options

- **code-server:** strongest current fit for a subordinate self-hosted Code surface. It provides VS Code in the browser,
  password authentication, reverse-proxy guidance, subpath and port proxying, reconnection behavior, and external-auth
  integration. It uses Open VSX rather than Microsoft's extension marketplace.
- **OpenVSCode Server:** stays closer to upstream VS Code but intentionally adds fewer self-hosting features and
  provides only basic connection-token security.
- **Eclipse Theia:** a framework for building a customized cloud IDE with VS Code extension and LSP support. Choosing it
  as the primary shell would largely replace the existing Workspace application and create a much larger commitment.
- **Monaco alone:** an editor component, not an IDE; using it as the foundation would require RunWield to build the rest
  of the development environment.

Conclusion: keep Workspace as the shell and evaluate code-server as an isolated subordinate service/screen.

### HumanLayer

Sources:

- <https://www.humanlayer.dev/>
- <https://docs.humanlayer.com/>
- <https://docs.humanlayer.com/guide/remote-daemons>

- Tasks group sessions, artifacts, and worktrees.
- Local and cloud daemons connect to one browser UI.
- Remote daemons use interactive device authorization or short-lived launch tokens.
- The product emphasizes workflow checkpoints, artifact review, semantic session visibility, and keyboard navigation.

Conclusion: strong product and UX reference, but RunWield should remain Plan-centered and avoid importing a generic Task
entity without evidence that it is needed.

## Existing RunWield Baseline

The current Workspace already provides:

- Astro/React shell;
- RunWield design-system integration;
- project-scoped Plan board;
- stable Plan IDs and canonical markdown Plan storage;
- lifecycle-safe actions;
- Plan and Epic details;
- body editing with stale-save protection;
- Plannotator Plan and code review surfaces;
- Shared Plan Spaces and capability-based remote review.

Relevant Work Records:

- `docs/work-records/2026-07-17-local-first-plan-management-workspace.md`
- `docs/work-records/2026-07-17-migrated-workspace-to-astro-react-and-plannotator.md`
- `docs/work-records/2026-07-17-workspace-plan-review-parity.md`

## Current Documentation Tensions

`docs/prd/runwield-workspace-PRD.md` currently says:

- Workspace is Plan-centered;
- the local server shows one project/checkout at a time;
- raw chat should not become planning memory;
- hosted execution comes later.

The new direction preserves Plan-centered UX and private-first conversations but changes the roadmap:

- local Workspace becomes multi-Project;
- native Agent Sessions become a first-class local/self-hosted surface;
- authenticated remote access becomes core;
- local Core execution can be observed and controlled from Workspace;
- SaaS container execution remains later.

The Workspace PRD has not yet been updated for this direction.

`docs/prd/runwield-acp-session-host-PRD.md` was updated earlier in the session to define OpenAB/Telegram validation and
full ACP compliance. That work remains useful but should be reconsidered as a secondary-channel milestone once the
Workspace priority is settled.

## Open Consequential Decision

The next conversation must resolve the primary durable grouping model.

### Recommended branch: no new Work Item

- Before a Plan exists, ideation is a private standalone Agent Session.
- When a Plan or PRD materializes, the originating session becomes associated with it.
- The Plan becomes the primary workflow page.
- Later planning, execution, review, validation, and recovery sessions are associated with that Plan.
- INQUIRY, OPERATION, and QUICK_FIX sessions can remain standalone because they intentionally have no Plan.

### Alternative: durable Work Item above Plans and Sessions

Introduce a HumanLayer-style container that groups the User Request, Agent Sessions, Plans, artifacts, worktrees, and
Work Records. This may simplify navigation but risks duplicating Plan identity, lifecycle, status, ownership, and
history.

Ask the user:

> Should pre-Plan ideation remain a standalone Agent Session that later attaches to a Plan, or should RunWield introduce
> a durable Work Item above Plans and Sessions?

## Further Discovery After That Decision

Resolve these product questions in dependency order:

1. Which entity owns collaboration and visibility: Agent Session, Plan, or a new Work Item?
2. What does registering, initializing, disabling, and removing a trusted Project mean without deleting project data?
3. Should the first remote local deployment use direct authenticated access, an outbound connector, or support both?
4. Which Agent Session content is private, team-visible, or explicitly shared, while artifacts remain the durable shared
   record?
5. How does Workspace surface concurrent sessions without becoming a generic agent fleet manager?
6. What is the smallest useful code-server integration: separate authenticated route, reverse-proxied screen, or deeper
   navigation bridge?
7. Which features belong in the first local/self-hosted milestone versus the later containerized SaaS runtime?

## Relevant Files

- `CONTEXT.md`
- `docs/design-system.md`
- `docs/prd/runwield-workspace-PRD.md`
- `docs/prd/runwield-core-prd.md`
- `docs/prd/runwield-acp-session-host-PRD.md`
- `docs/acp-implementation-details.md`
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md`
- `src/shared/session/session-runtime.js`
- `src/shared/session/session-runtime-events.js`
- `src/shared/session/session-runtime-interactions.js`
- `src/ui/workspace/`
- `third_party/plannotator/adr/0002-add-webtui-agent-panel-for-annotate-mode.md`
- `third_party/plannotator/adr/implementation/annotate-agent-terminal-recap.md`

## Recommended Next Action

Continue Ideator discovery from the open grouping-model decision. After that decision tree and the local/self-hosted
milestone boundary are resolved, explicitly update `docs/prd/runwield-workspace-PRD.md`. Do not begin implementation or
formal PROJECT planning before the updated product boundary is accepted.
