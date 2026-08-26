---
title: "RunWield Workspace Session Screen"
status: "draft"
createdAt: "2026-08-25T12:21:11-04:00"
updatedAt: "2026-08-25T12:21:11-04:00"
---

# RunWield Workspace Session Screen

## Objective

Rewrite the Workspace Session screen as a complete browser UI for `SessionRuntime`, alongside the TUI and ACP adapters.
The scope is the Session screen only. It covers the two Session states:

- **New Session**: the user has not submitted the first User Request.
- **Existing Session**: the Session has been minted and has a committed conversation history.

The screen must be approachable for non-engineers using Ideator, prototypes, research, and planning workflows while
remaining fully useful for developers.

The Attention Dashboard and the rest of Workspace navigation are separate product surfaces and are not redesigned by
this PRD. The selected-Session Workflow Rail defined in `docs/prd/workflow-rail-prd.md` is included in this Session
screen work.

## Problem Statement

The current Workspace Session surface can display and continue Sessions, but it does not provide the full interactive
capability of the TUI. Important SessionRuntime capabilities are missing or less usable in the browser, including slash
commands, `@` input behavior, cancellation, steering, queued messages, structured interactions, Agent and model
controls, and developer-oriented runtime visibility.

The result is two different experiences over the same SessionRuntime. Users who move between TUI and Workspace must
learn which surface can perform which action. Non-engineers also encounter a technical continuation surface instead of a
clear starting point for exploring an idea, creating a prototype, or preparing a Plan.

## Users and Outcomes

### Product managers and designers

They can start with a plain-language outcome or type an idea directly. They can use Ideator, research, prototypes, and
planning workflows without learning terminal concepts.

### Engineers

They can use the same Session capabilities as the TUI from a browser, including command access, steering, cancellation,
context controls, Agent and model controls, tool visibility, and workflow evidence.

### All users

They can move between TUI and Workspace without losing the Session model, transcript continuity, workflow state, or
control rules.

## Product Experience

### New Session state

The new Session screen is intentionally quiet and focused. It does not become a dashboard or show a large welcome hero.
Near the lower middle of the screen, close to the composer, it shows a small set of intent cards:

- Explore an idea — Ideator
- Ask about `<Project Name>` — Guide
- Create a prototype — Ideator with the Prototype Skill
- Plan implementation — Planner
- Start an Epic — Architect
- Build or fix something — Engineer

The user has two equivalent entry paths:

1. Select an intent card, then write and submit the actual User Request.
2. Type a User Request directly and let Router select the appropriate Agent.

Selecting an intent:

- selects the corresponding canonical Agent and, for **Create a prototype**, activates the Prototype Skill;
- changes the composer placeholder and helper text;
- shows a preparation state explaining the selected outcome;
- keeps the intent cards or a clear selected-intent state visible until submission;
- provides **Try something else**, which returns to the intent list;
- never inserts text into the composer;
- never submits a fake or incomplete User Request.

The composer must have a visible label. A placeholder is supporting guidance, not the only label.

When the user submits the first User Request, the Session is minted. All welcome messaging, intent cards, preparation
content, and **Try something else** controls disappear. The screen changes to the Existing Session state.

### Existing Session state

The Existing Session screen is the normal Session experience:

- one ordered conversation timeline;
- committed transcript entries and clearly distinct live Workspace waits;
- a persistent composer with natural-language User Requests;
- slash command support and command completion;
- `@` behavior matching the TUI;
- structured interaction controls for questions, choices, approvals, and other Runtime interactions;
- visible active-operation progress;
- cancellation through Escape and a browser Stop action;
- steering and queued User Requests;
- Agent, model, Session, context, and settings actions through toolbar or menus;
- access to equivalent slash commands through the composer;
- workflow and Plan progress through the selected-Session Workflow Rail when a workflow is active;
- artifacts, reviews, prototypes, and other important results as readable inline cards or linked surfaces;
- developer detail available through progressive disclosure rather than forced into every message.

The Workflow Rail follows `docs/prd/workflow-rail-prd.md`:

- it appears only for an active multi-step workflow;
- it shows the current stage, active owner, subject, reason, next safe action, available actions, and evidence;
- it contains persistent validation-loop state;
- it does not appear for ordinary Ideator, Guide, or idle chat;
- it does not become a second source of truth for Plans, validation, worktrees, recovery, or Session Control.

The existing Session screen must preserve single-writer Session semantics without presenting control as a user contest.
There is no **Take control** action. Opening an idle Session makes it usable in Workspace. If the Session is busy in the
TUI, ACP, or another Workspace operation, Workspace shows the transcript read-only and overlays a clear Busy state on
the disabled composer. When the Session becomes idle, the Workspace composer becomes available without a takeover flow.

Control must not change while the user is composing. This product assumes one person moving between surfaces, not
several people competing to write to one Session. Draft text and image previews remain intact while the composer is
temporarily unavailable.

## Interaction Rules

### Composer

The composer is the central control surface in both Session states. It supports:

- natural-language User Requests;
- `/` slash commands with the established TUI semantics;
- `@` with the established TUI semantics;
- image attachments matching current TUI behavior;
- draft preservation;
- queued messages while work is active;
- steering of active work where supported;
- visible send, steer, cancel, and interaction actions.

While the Agent is active, the normal Send action queues the User Request for the next turn. A separate **Steer** action
sends the draft as guidance to the active turn. The UI must label the distinction clearly and must not make users infer
it from an icon alone. Slash commands submitted during active work retain their current queued behavior.

`!` and `!!` shell command syntax are not part of the Workspace composer.

Only image attachments are in scope. Image paste or selection, preview, removal, draft persistence, model-capability
preflight, and failed-send restoration must match the TUI behavior. Other document and file attachment types are
deferred.

Ctrl+C clears the current input and related image previews. It must never exit the browser Session or Workspace process.
Escape cancels active Runtime work, including Agent calls, subprocesses, validation, interactions, and queues, according
to the existing SessionRuntime cancellation contract.

### Agent and outcome language

Canonical Agent names remain stable internally. Browser labels may use approachable outcome language, with the canonical
Agent name available as secondary information for users who need it.

The New Session intent mapping is:

| User-facing intent             | Agent behavior                   |
| ------------------------------ | -------------------------------- |
| **Explore an idea**            | Ideator                          |
| **Ask about `<Project Name>`** | Guide                            |
| **Create a prototype**         | Ideator with the Prototype Skill |
| **Plan implementation**        | Planner                          |
| **Start an Epic**              | Architect                        |
| **Build or fix something**     | Engineer                         |

The same display-language approach should be available to the TUI where appropriate, but changing TUI presentation is
outside this PRD unless required for shared parity.

### Progressive disclosure

The default view prioritizes the User Request, Agent response, decisions, artifacts, and the next useful action.
Technical detail remains available through expansion:

- tool calls and tool output;
- model and Execution Backend;
- context usage and compaction;
- files and diffs;
- validation evidence;
- Session diagnostics;
- developer-only shell or repository controls where separately supported.

Technical detail must not be fabricated or hidden when it is needed for a consequential workflow decision.

### Responsive behavior

The Session screen must remain usable on narrow screens. The conversation remains primary and uses the available narrow
width with reduced secondary information.

On mobile:

- a button in the top-right opens and closes the Workflow Rail as a panel;
- the rail does not permanently reduce the conversation width;
- Agent, model, and thinking controls remain available in compact form;
- New Session intents become a vertical list near the composer;
- structured interactions, tool groups, and the composer use the same behavior as desktop in a single-column layout;
- control state, pending interactions, drafts, and important workflow decisions remain visible and usable.

## TUI Capability Inventory

The Workspace Session screen must provide capability parity with the TUI through browser-appropriate controls. The TUI
syntax remains available where the capability is supported; toolbar and menu actions improve discoverability.

### Commands

| TUI command or group                              | Workspace treatment                                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/agent`                                          | Must work in the Session composer and have a browser selector near the composer footer.                                                                          |
| `/model`                                          | Must work in the Session composer and have a browser selector near the composer footer.                                                                          |
| `/login`, `/logout`, `/status`                    | Must work from the Session composer. The browser equivalent may live in global Workspace settings.                                                               |
| `/new`                                            | Must work and return to the New Session state.                                                                                                                   |
| `/resume`                                         | Must work through Session navigation or a browser Session picker.                                                                                                |
| `/name`                                           | Must preserve current rename semantics through Session actions and the composer.                                                                                 |
| `/session`                                        | Must work through a Session information and diagnostics panel.                                                                                                   |
| `/context`                                        | Must preserve current context-report semantics through a context panel.                                                                                          |
| `/compact`                                        | Must preserve current compaction semantics through a context action.                                                                                             |
| `/settings`                                       | Must work through Session or Workspace settings as appropriate.                                                                                                  |
| `/reload`                                         | Must preserve current reload semantics through browser-appropriate refresh and synchronization behavior.                                                         |
| `/theme`                                          | The capability remains available through browser appearance settings; terminal-specific presentation is not copied.                                              |
| `/load-plan`                                      | Must work through the composer and a prominent browser action. Both paths open a quick-filtered Plan modal with the TUI Plan list behavior.                      |
| `/plans`                                          | Must open a modal with a quick-filtered Plan list and a button to navigate to the full Plans Dashboard.                                                          |
| `/init`                                           | Must work if it is a Session workflow action.                                                                                                                    |
| `/sleep`                                          | Remains a supported prompt command.                                                                                                                              |
| `/export`                                         | Must work through Session actions with browser download behavior.                                                                                                |
| `/share`                                          | Must create a revocable Workspace-owned anyone-with-the-link read-only Session snapshot. A TUI connected to Workspace uses the same flow instead of GitHub Gist. |
| `/copy`                                           | Excluded as a Workspace slash command. Browser selection or a message-level copy affordance is sufficient.                                                       |
| `/help`                                           | Must work through command completion and browser help.                                                                                                           |
| `/version`                                        | Excluded from the Workspace Session command surface because it has no useful Session-screen meaning.                                                             |
| `/quit`, `/exit`                                  | Do not exit Workspace. A browser Session may provide navigation away from the Session instead.                                                                   |
| `/acp`, `/workspace`, `/router`                   | Not Session actions; do not expose as Session controls.                                                                                                          |
| `/wr`                                             | Must open a modal with a quick-filtered Work Record list and a button to navigate to a future full Work Records listing page.                                    |
| `/update`, `/install`, `/remove`, `/snip-filters` | Not Session actions; do not expose as Session controls.                                                                                                          |

### Composer behavior

The Workspace composer must support natural-language User Requests, slash commands with completion, `@` behavior, prompt
templates, Skills, attachments, draft preservation, queued messages, steering, cancellation, and structured
interactions.

Slash completion must match the TUI capability through a browser menu anchored above the composer, similar to the Codex
composer pattern:

- typing `/` opens the available command and Skill suggestions;
- typing filters suggestions immediately;
- each row shows the command or Skill name and a short description;
- commands, Skills, prompt templates, and relevant completion groups remain visually distinguishable;
- arrow keys move the active option and Enter selects it;
- pointer and touch selection work without changing keyboard behavior;
- commands with known arguments provide TUI-equivalent Agent, model, and Plan completion;
- the menu remains compact and does not cover more transcript history than needed.

The `@` file picker must match the TUI behavior:

- typing `@` opens a file list rooted in the current Project directory;
- the list includes visible relative file and directory paths;
- typing filters the available paths as the user types;
- the user can navigate directories and select a file;
- selecting a file adds its path to the User Request as context;
- the current Project and active worktree determine the available file root.

The TUI behaviors that do not transfer literally are shell commands (`!` and `!!`) and terminal process exit behavior.
Enter/newline behavior may use browser conventions, but sending, draft preservation, and cancellation must remain clear
and accessible.

### Runtime and Session controls

The Workspace must provide browser equivalents for:

- Agent selection and workflow context, with the Agent selector near the composer footer;
- model and provider selection, with the model selector near the composer footer;
- provider authentication status;
- thinking level;
- context usage and compaction;
- Session rename, resume, export, share, copy, and diagnostics;
- Session Control state and a visible Stop action;
- queued and steered User Requests;
- cancellation of Agent work, subprocesses, validation, interactions, and queues.

The Agent selector must preserve current TUI switching semantics:

- manually selectable Agents use approachable display labels with the canonical Agent name available as secondary text;
- workflow-only Agents are not manually selectable;
- an idle Agent switch applies immediately;
- an Agent switch submitted during an active turn queues for the next turn;
- a successful manual switch releases an active workflow according to the current Runtime behavior;
- failed switches preserve the current Agent, model, and workflow;
- planned-work recovery evidence and Quick Fix working-tree consequences remain unchanged;
- Workspace does not add a browser-only confirmation or alter these semantics.

The model selector must show provider, model, current selection, search, and model-list refresh. Thinking level belongs
in the model control and must show when the model does not support thinking. If the active Execution Backend cannot
change the current Session model, the UI must explain that the choice applies later rather than claiming an immediate
switch.

Provider credentials are global. Login, logout, and provider status belong in global Workspace settings, while their
slash commands open the relevant browser settings or status flow from the Session.

The Session screen must provide a prominent **Load Plan** action in addition to `/load-plan`. Both paths open a modal
with quick filtering and the same top-level Plan selection behavior as TUI. Selecting a Plan enters a browser-adapted
recovery wizard when the Plan requires lifecycle, review, worktree, or other recovery decisions. The wizard must explain
each choice and its consequence before continuing.

### Runtime interactions

The Workspace must replace generic browser prompts with structured controls for:

- text input;
- select input;
- approval decisions;
- Plan review;
- code review.

Text, select, approval, and recovery interactions should follow the TUI interaction shape with browser affordances. A
choice interaction must support:

- selecting an option by clicking;
- moving through options with the keyboard;
- submitting the selected option with Enter;
- choosing **Other** and entering a custom answer;
- submitting the custom answer with a button or keyboard;
- visible focus, selected state, labels, and error feedback.

The control must not force users to type a textual version of a choice when a button or keyboard selection is available.

When the Agent emits `plan_written`, the Workspace navigates to the planning screen for the new Plan. Plan feedback,
annotations, and approval resolve the waiting Session interaction and return their outcome to the Session. Code Review
uses the same pattern: navigate to its dedicated review screen, then return feedback, annotations, or approval to the
waiting Session.

Prototype results open in a new browser tab. Resume, Load Plan, Plan list, and Work Record list flows use browser
modals. Each slice may refine its modal content while preserving the common quick-filter, selection, keyboard, and
navigation behavior.

Link interactions open their destination in a new browser tab so the Session remains available. Interaction cancellation
and lost live waits must follow the existing SessionRuntime interruption rules.

### Validation and recovery

The Workspace Workflow Rail must show validation progress, validation reports, repair state, recovery state, and the
current safe next action. Persistent validation-loop state must not use the old full-width validation card above the
composer.

Existing repair and recovery semantics remain unchanged. The browser must continue to use the current canonical
workflow, Plan, worktree, and validation authorities. The change is the presentation: ambient progress moves to the
Workflow Rail, while blocking choices use the same structured `user_interview` controls as other Runtime interactions.

Examples of blocking choices include:

- retry or stop after a failed validation;
- recover a stale or interrupted workflow;
- choose how to continue a Plan lifecycle decision;
- approve, reject, or provide feedback during review;
- confirm another user-owned workflow transition.

The rail must not claim that validation has succeeded when only progress data is available. Detailed recovery flows may
use a browser wizard, but every decision must preserve the existing lifecycle consequences and return to the Session
when the waiting Runtime interaction is resolved.

### Transcript and workflow rendering

The Workspace must render the semantic Runtime event categories that the TUI renders, using browser-appropriate
presentation.

#### Long Session navigation

Long Sessions use upward infinite loading. The first view opens near the latest committed history. When the user scrolls
toward the top, Workspace loads older committed messages without moving the visible reading position.

While the user remains near the latest content, new streaming activity may keep the view at the bottom. When the user
has scrolled away to read older history, new activity must not move the viewport. Instead, the timeline shows a clear
new activity marker and an action to return to the latest content. Loading and segment boundaries must not create
duplicate, missing, or reordered transcript entries.

#### Collapsible tool activity

Tool activity must use compact, collapsible blocks inspired by the established harness pattern:

- while tools are running, each call appears as one compact line;
- the line preserves the RunWield tool name and its most useful argument, such as `read src/plan-store.ts`,
  `write docs/prd/example.md`, or `code_search SessionRuntime`;
- generic labels such as `Edited files` must not replace the actual tool header;
- tool output is not expanded by default;
- contiguous tool calls remain visible as separate live lines while the tool work is active;
- when the next thinking block or Agent message begins, the contiguous calls become one collapsed expandable tool group;
- the collapsed group shows a useful summary, such as the number and type of tool calls;
- expanding the group reveals each call with its original tool header, output, errors, and relevant file or diff
  details;
- an important user-facing result may render as a richer artifact or review card instead of remaining only in the tool
  group.

This presentation keeps the conversation readable without hiding technical evidence. Tool groups remain part of the
Session history and must preserve the distinction between committed events and temporary live waits.

- User Requests and Agent responses;
- streaming text and thinking;
- expandable tool activity and output;
- system status and errors;
- cancellation and recovery;
- queued and steered messages;
- usage and context information;
- Agent and model changes;
- workflow stages;
- validation progress and reports;
- Plan and code review;
- artifacts, prototypes, and links;
- Session Control and synchronization state.

Committed transcript history must remain distinct from temporary live waits. Technical detail should use progressive
disclosure rather than disappear.

### Deferred slice-level interaction details

Browser export format choices are deferred until their implementation slice. The slice must preserve the export
capability requirement in this PRD and can refine output formats with focused product review.

### Workspace Session sharing

Sharing is Workspace-owned. In Workspace, `/share` opens a sharing flow that creates an anyone-with-the-link read-only
Session snapshot. A TUI connected to Workspace uses the same Workspace sharing flow instead of creating a GitHub Gist.
Richer team, identity, permission, and collaboration controls are deferred until Workspace team dynamics exist.

Each Session has at most one active Shared Session Snapshot. The snapshot contains only committed Session history
available when the owner creates or updates it. Later Session messages, tool activity, artifacts, and decisions never
appear automatically.

Updating the snapshot explicitly replaces its content behind the same share link. Rotating the share secret creates a
new link and disables the old link. Revoking sharing disables the active link without changing or deleting the original
Session. The exact URL and token format are implementation details.

The shared view preserves the Session timeline. User Requests and Agent messages appear normally. Committed tool calls
are included as expandable groups that preserve their RunWield tool headers and start collapsed. Model thinking and
temporary live waits are not included. The owner sees a preview of the snapshot before creating the link.

## Technical Approach

Workspace will be a sibling adapter over the existing adapter-neutral `SessionRuntime` contract, like TUI and ACP. The
Workspace Session screen must consume Runtime snapshots, semantic events, actions, and typed interactions rather than
reimplementing Session lifecycle or workflow semantics.

The implementation should extend the existing Workspace Session surface and shared RunWield design system. It must
preserve:

- file-authoritative Session identity and transcript continuity;
- Session Transcript and Session Transcript Segment semantics;
- Session Control and Session Writer Lock rules;
- canonical Plan, workflow, validation, and artifact authority;
- exact evidence checks for consequential Plan actions;
- interruption behavior when a process-local live wait is lost;
- current Workspace security and Project boundaries.

The browser UI should use the existing Workspace visual language and semantic `--rw-*` design tokens. It must not create
a separate visual system for Sessions. The implementing Plan must update the current design-system guidance that
describes a high-risk **Take control** action so it matches this PRD's single-user idle/Busy behavior.

## Success Criteria

A successful Session screen will allow a user to:

1. Start a New Session from an intent card without having to understand Agent names.
2. Start the same workflow by typing directly and relying on Router.
3. Change the selected intent before submission without losing a draft.
4. Submit the first User Request and transition cleanly to the Existing Session state.
5. Use TUI-equivalent slash completion and `@` file completion from compact browser menus above the composer.
6. Cancel active work with Escape or the browser control without exiting the Session.
7. Observe, control, steer, queue, and resume Sessions according to existing Session Control rules.
8. Complete structured Runtime interactions in the browser.
9. Queue a normal message during active work or deliberately steer the active turn with a separate action.
10. Move from `plan_written` to Plan Review and return feedback, annotations, or approval to the waiting Session.
11. Move from Code Review to the waiting Session with feedback, annotations, or approval.
12. Use a prominent Load Plan action or `/load-plan` to select a Plan and complete browser recovery decisions.
13. Use Agent and model selectors near the composer footer.
14. Use `@` to find and attach current Project files with the same filtering behavior as TUI.
15. Paste, preview, remove, preserve, and submit image attachments with TUI-equivalent capability checks.
16. Use `/plans` and `/wr` to open quick-filtered artifact modals and navigate to their full destination surfaces.
17. See active tool calls as compact lines and completed contiguous tool activity as expandable groups.
18. Load older history by scrolling upward without losing reading position, and follow a marker to new activity.
19. Open and close the Workflow Rail on mobile without losing the primary conversation.
20. Open a Busy Session read-only, retain a draft, and use the composer when the Session becomes idle without a takeover
    flow.
21. Create, update, rotate, and revoke one Shared Session Snapshot for a Session.
22. Access developer-level detail without making it the default experience.
23. Move between TUI and Workspace while retaining the same Session history and workflow truth.

## Resolved Assumptions

- The Workspace Session screen is not the Attention Dashboard.
- The Session screen has two product states: New Session and Existing Session.
- The New Session welcome state ends permanently after the first submitted User Request.
- Intent selection changes Agent preparation and composer guidance but does not create or submit content.
- **Try something else** exists only before the first User Request is submitted.
- Direct natural-language input is always allowed.
- Router remains responsible for direct-request classification and routing.
- Intent cards map to Ideator, Guide, Ideator with the Prototype Skill, Planner, Architect, and Engineer as defined
  above.
- During active work, Send queues and a separate Steer action guides the active turn, following the Codex composer
  pattern.
- Workspace and TUI retain their existing single-writer Session relationship without a **Take control** action.
- Opening an idle Session makes its composer available; a Busy Session shows a disabled-composer overlay until it
  becomes idle.
- Session control does not change while the user is composing, and drafts remain intact while the composer is
  unavailable.
- The selected-Session Workflow Rail is part of the Workspace Session screen and follows
  `docs/prd/workflow-rail-prd.md`.
- Persistent validation-loop state appears in the Workflow Rail, not in the old full-width validation card.
- Blocking repair, recovery, and review choices use structured `user_interview` controls.
- Choice controls support click, keyboard selection plus Enter, and **Other** with typed submission.
- Agent switching preserves current TUI and SessionRuntime behavior without a Workspace-only confirmation.
- Agent and model selectors appear near the composer footer; thinking level is part of the model control.
- Provider authentication and status live in global Workspace settings and remain reachable through slash commands.
- Rename, context, compaction, and reload preserve their current semantics through browser controls.
- `/copy` is excluded from the Workspace command surface because browser-native copying is sufficient.
- `/share` creates one active revocable Workspace-owned anyone-with-the-link snapshot per Session; explicit updates
  replace its content behind the same link, secret rotation disables the old link, later Session activity is never added
  automatically, tool groups start collapsed, and connected TUI Sessions use the same flow.
- `/plans` opens a quick-filtered Plan modal with navigation to the full Plans Dashboard.
- `/wr` opens a quick-filtered Work Record modal with navigation to a future Work Records listing page.
- `@` opens a current-Project file picker that filters paths as the user types and attaches the selected path to the
  User Request.
- Image attachments match the TUI; non-image attachment types are deferred.
- Long Sessions load older committed history as the user scrolls upward and show a new activity marker when the user is
  reading older content.
- Slash completion matches TUI behavior in a compact browser menu above the composer.
- Browser export formats are deferred to their implementation slice.
- Slash commands are an established part of the Workspace composer, not a developer-only fallback.
- `!` and `!!` are excluded from Workspace.
- Ctrl+C clears input; it does not exit Workspace.
- Escape cancels active Runtime work.

## Out of Scope

- Redesigning the Attention Dashboard described in `docs/plans/personal-remote-workspace-v2.md`.
- Redesigning Workspace Project navigation or Plan Board surfaces.
- Changing SessionRuntime lifecycle, authority, locking, or transcript semantics.
- Adding browser-specific Session behavior that diverges from TUI capability semantics without an explicit product
  reason.
- Replacing slash commands with menus or toolbar controls. Menus and toolbars are complementary access paths.
- Making `!` or `!!` shell commands available in the browser.
- Seamless mid-operation transfer between TUI and Workspace when the current Runtime contract does not support it.
- Multiplayer competition for Session Control or a manual **Take control** workflow.
- Non-image attachment types.
- Defining prototype storage, prototype editing, or prototype publication behavior beyond displaying and linking
  relevant artifacts in the Session.
- Building a browser Code Surface.
- Building the full Work Records listing page; the `/wr` modal may link to that future surface when it exists.
- Redesigning or redefining the Workflow Rail product contract; this Session screen implements the selected-Session
  browser rendering defined in `docs/prd/workflow-rail-prd.md`.

## Proposed Domain Language

The existing terms **Workspace**, **Session**, **Session Control**, **User Request**, **Router**, **Agent**,
**Ideator**, **Planner**, and **SessionRuntime** remain canonical.

The UI labels **Explore an idea**, **Ask about `<Project Name>`**, **Create a prototype**, **Plan implementation**,
**Start an Epic**, and **Build or fix something** are presentation labels for existing Agents and Routing Intents, not
new domain entities.

### Shared Session Snapshot

The one active, revocable, read-only copy of committed Session history shared from a Session and available to anyone who
has its bearer link. It changes only when the owner explicitly updates it. Later activity in the original Session is
never added automatically. Rotating its share secret disables the old link. The snapshot does not grant Session Control,
Project access, or access to the live Session.

Affected existing terms: Session, Session Transcript, Workspace, Session Control.

Avoided aliases: shared Session, public Session, live Session link, collaborative Session.
