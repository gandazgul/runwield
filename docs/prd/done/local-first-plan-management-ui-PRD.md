---
title: Local-First Plan Management UI
status: done
createdAt: "2026-06-24T00:00:00.000Z"
completedAt: "2026-07-17T04:52:54.858Z"
---

# Local-First Plan Management UI PRD

## Completion Status

This PRD is complete and archived. The local-first Plan Board shipped as the RunWield Workspace Plan UI under
`src/ui/workspace/`, launched by `wld plans ui` through `src/cmd/plans/ui.js`. The implementation now uses Astro SSR,
React islands, Tailwind 4, Radix-compatible RunWield primitives, and selective Plannotator reuse for document/editor and
review surfaces. That current implementation supersedes the original Fresh/Preact/UnoCSS prototype direction captured
earlier in this document.

Verified completion evidence lives in:

- `docs/work-records/2026-07-15-workspace-plan-ui.md`
- `docs/work-records/2026-07-17-migrated-workspace-to-astro-react-and-plannotator.md`

The binding architecture update is recorded in
`docs/adr/007-local-first-workspace-plan-board.md#2026-07-amendment-astro-react-radix-and-plannotator-workspace-migration`.

## Problem Statement

RunWield saves Plans as markdown files with Front Matter, but the main ways to inspect and manage those Plans are
terminal-oriented. `wld plans` can list saved Plans, and `wld load-plan` can resume a single Plan, but neither gives the
user a persistent visual workspace for comparing active work, seeing Epic progress, reading Plan bodies, editing Plan
text, or manually moving Plans through their lifecycle.

As Plan counts grow, especially with PROJECT Epics decomposed into child FEATURE Plans, a terminal list makes it harder
to answer ordinary planning questions:

- Which Plans are still drafts?
- Which Plans are ready for work?
- Which Epics have child FEATURE Plans waiting?
- Which Plans are implemented but not verified?
- Which Plans did the user manually close without RunWield Workflow Validation?
- Which Plans are on hold and should stop polluting active work?

The user wants a browser-based management surface that feels like a practical local workspace, while preserving the
existing RunWield invariant that Planner, Architect, Slicer, and `load-plan` all read and write canonical markdown Plans
in the checkout. The Plan Board should also avoid becoming a cul-de-sac, but that does not mean RunWield should become a
Notion clone. Plans and Boards should be malleable, low-friction, and easy to link from other tools such as Slack, Jira,
Notion, GitHub issues, project docs, or whatever the team already uses. Over time, Plans may live beside project
documentation, wiki-style pages, project files, meeting notes, and other knowledge, but v1 should keep the door open
through durable resource identity and shareable URLs rather than by building a general-purpose knowledge workspace.

## Solution

Add a local-first Plan Board launched by `wld plans ui`. The command starts an ephemeral local Plan UI Server for the
current checkout and opens a browser URL. Production UI code should live under `src/ui/workspace/`, with the CLI
launcher owned by `src/cmd/plans/ui.js`. The Plan UI Server reads and writes the checkout's `plans/` directory; no
database is required for v1.

The Plan Board is implemented as the first concrete view inside a Workspace-capable browser shell, not as a closed
Plan-only interface. In v1, the local Workspace is the checkout from which `wld plans ui` was launched, and the shell
may expose only Plans. Internally, the Plan Board is a Workspace resource/view. Its navigation, route model, editor
boundary, and data adapter shape should still allow future resource types such as documentation pages, wiki pages,
notes, and project files to appear alongside Plans.

Plan URLs should be pretty, durable, and shareable. A Plan, Epic, board view, and relevant filtered state should have
stable browser URLs that users can paste into Slack, Jira, Notion, GitHub issues, docs, or chat. Local URLs may require
a running `wld plans ui` server, but the path and resource identifiers should remain stable across sessions and should
be designed so future hosted/self-hosted modes can resolve the same conceptual link. For now, each Plan UI instance is
scoped to one project/workspace: either the local checkout that launched `wld plans ui` or one hosted project. The UI
should not become a super-dashboard over all of a user's projects in v1. Each Plan should have a globally unique Plan ID
so project-scoped URLs can stay simple, such as `/plan-id`, while future hosted/self-hosted modes can resolve the same
conceptual link without requiring a project selector in every URL.

The Plan Board shows top-level Plan Cards grouped by Plan Status. This top-level board must be RunWield-owned UI, not an
editor-owned database, canvas, or embedded AFFiNE board. The Plan Board needs direct control over Plan Lifecycle
actions, event recording, drag-and-drop semantics, card density, Epic behavior, closed/on-hold screens, and future
Workspace navigation. Clicking a non-Epic Plan Card opens a read-first Plan detail view with rendered markdown and a
prominent Edit action. Clicking an Epic Plan Card opens an Epic detail view that shows child FEATURE Plan progress and
lets the user inspect the Epic's children without flattening every child onto the main board by default.

The Plan Editor edits only the markdown body by default. Workflow-critical Front Matter fields are changed through
structured controls or Plan Lifecycle actions. Editing is save-only: text changes are not written to disk until the user
explicitly saves. Drag-and-drop status moves may apply immediately, but they must record Plan Events or explicit manual
lifecycle changes instead of mutating Front Matter directly.

The first implementation is local and plaintext over localhost because it operates on trusted local files. Hosted,
self-hosted, encrypted collaboration remains future work and should continue to follow the collaborative planning
principle that remote servers store ciphertext only. For this PRD, remote storage, remote databases, AFFiNE hosting,
OctoBase, and y-octo synchronization are out of scope except as future-facing research notes.

## User Stories

1. As a RunWield user, I want to start a local Plan Board with `wld plans ui`, so that I can manage Plans in a browser
   without leaving the current checkout.
2. As a RunWield user, I want the Plan UI Server to be tied to the current checkout, so that the board shows the same
   Plans that Planner, Architect, Slicer, and `load-plan` use.
3. As a RunWield user, I want the Plan Board to group Plans by Plan Status, so that I can scan work by lifecycle state.
4. As a RunWield user, I want draft, feedback, approved, ready-for-decomposition, ready-for-work, in-progress, failed,
   and implemented Plans on the active board, so that active work is visible in one place.
5. As a RunWield user, I want terminal Plans such as verified and closed-without-verification to live in a closed screen
   or tab, so that completed work does not dominate daily planning.
6. As a RunWield user, I want on-hold Plans to be visually separate from both active and closed work, so that paused
   Plans are not confused with completed Plans.
7. As a RunWield user, I want top-level FEATURE Plans to appear as individual cards, so that I can manage independent
   executable work.
8. As a RunWield user, I want PROJECT Epics to appear as single Epic-tagged cards, so that large projects do not flood
   the main board with every child FEATURE Plan.
9. As a RunWield user, I want Epic cards to summarize child FEATURE progress, so that I can see how much of an Epic is
   draft, active, on hold, failed, implemented, or verified without opening every child Plan.
10. As a RunWield user, I want clicking an Epic card to open an Epic detail view, so that I can inspect child FEATURE
    Plans in context.
11. As a RunWield user, I want clicking a non-Epic Plan Card to open a read-first detail view, so that inspection is
    safer and faster than editing.
12. As a RunWield user, I want a prominent Edit action in the detail view, so that editing is easy but deliberate.
13. As a RunWield user, I want a card menu action to open the editor directly, so that frequent editing workflows stay
    efficient.
14. As a RunWield user, I want the detail view to render markdown clearly, so that Plans are readable for both technical
    and non-technical review.
15. As a RunWield user, I want the detail view to show Front Matter summary fields, so that I can see classification,
    complexity, status, parent Plan, dependencies, affected paths, and worktree state without reading raw YAML.
16. As a RunWield user, I want the Plan Editor to edit the markdown body only, so that I do not accidentally corrupt
    workflow-critical Front Matter.
17. As a RunWield user, I want Front Matter changes to go through structured controls, so that Plan Classification, Plan
    Status, dependencies, parent Plan pointers, and worktree metadata remain valid.
18. As a RunWield user, I want editor changes to write only on Save, so that partial edits do not break Planner,
    Architect, Slicer, or `load-plan` while I am typing.
19. As a RunWield user, I want browser-local draft recovery for unsaved editor changes, so that accidental refreshes do
    not lose text before Save.
20. As a RunWield user, I want drag-and-drop between status columns, so that manual Plan management feels direct.
21. As a RunWield user, I want drag-and-drop moves to record lifecycle events, so that the Plan file history remains
    semantically meaningful.
22. As a RunWield user, I want to manually move a Plan from draft to ready-for-work when I decide it is ready, so that I
    can bypass a formal Review Loop when appropriate without lying that the Review Loop happened.
23. As a RunWield user, I want to manually mark a Plan as in-progress, so that externally started work is reflected in
    the Plan Board.
24. As a RunWield user, I want to manually mark a Plan as implemented, so that externally completed work is visible
    without claiming RunWield verified it.
25. As a RunWield user, I want failed Plans to require recovery-specific actions, so that mechanical recovery state is
    not casually overwritten by board drag-and-drop.
26. As a RunWield user, I want FEATURE Plans to reach verified only through Workflow Validation, so that verified keeps
    its current meaning.
27. As a RunWield user, I want to close a Plan without verification, so that I can mark manually accepted or externally
    verified work as done without pretending RunWield validated it.
28. As a RunWield user, I want closed-without-verification to be distinct from verified, so that I can audit what
    RunWield validated versus what I manually accepted.
29. As a RunWield user, I want to put a Plan on hold from the board, so that deferred work stops appearing as normal
    active work.
30. As a RunWield user, I want resuming an on-hold Plan to follow the Resume Check model, so that stale or risky work is
    not resumed silently.
31. As a RunWield user, I want the Plan Board to preserve markdown Plan files as the canonical source of truth, so that
    command-line workflows keep working.
32. As a RunWield user, I want the local Plan Board to avoid a database in v1, so that the feature stays simple and
    deploys with the existing filesystem model.
33. As a RunWield user, I want the editor technology to be replaceable, so that RunWield can evolve the Workspace
    document/editor surface without betting the Plan Lifecycle on one editor implementation.
34. As a RunWield user, I want markdown round-trip fidelity tested before adopting a rich editor, so that Plans do not
    lose code fences, tables, checklists, headings, links, or other important structure.
35. As a future collaborator, I want the local Plan Board to leave room for encrypted remote collaboration, so that the
    later hosted/self-hosted mode can reuse concepts without compromising local workflow.
36. As a RunWield user, I want Plans to eventually live beside project documentation, meeting notes, and wiki pages, so
    that planning work is part of the same project knowledge space.
37. As a RunWield user, I want the v1 Plan Board shell to leave room for non-Plan resources, so that future Workspace
    work does not require replacing the Plan UI.
38. As a RunWield user, I want future documentation and notes to use the same editor foundation where practical, so that
    the interface feels coherent across Plans and non-Plan documents.
39. As a RunWield user, I want Plan-specific lifecycle controls to remain Plan-specific, so that general documents do
    not inherit Plan Status or Workflow Validation concepts that do not belong to them.
40. As a RunWield user, I want Plans to remain readable as normal markdown even inside a broader Workspace, so that
    agents and command-line workflows never depend on a proprietary document database.
41. As a RunWield user, I want every Plan and Epic detail view to have a pretty stable URL, so that I can paste it into
    Slack, Jira, Notion, GitHub issues, docs, or chat without friction.
42. As a RunWield user, I want board/filter URLs to be shareable, so that I can point someone at "ready for work",
    "implemented but not verified", an Epic's children, or a closed/on-hold screen directly.
43. As a future self-hosted user, I want local Plan URLs to map cleanly to hosted/self-hosted URLs later, so that links
    created during local work do not become throwaway references.
44. As a RunWield user, I want one Plan UI instance to show one project/workspace at a time, so that the board stays
    focused and does not become a global multi-project dashboard before that product need exists.
45. As a RunWield user, I want each Plan to have a globally unique ID, so that shared Plan URLs can be short, durable,
    and independent of title/path changes.

## Implementation Decisions

- The v1 Plan Board is local-first. It is launched by a CLI command that starts an ephemeral local Plan UI Server and
  opens a browser URL.
- The production package boundary is `src/ui/workspace/`. The command boundary is `src/cmd/plans/ui.js`.
- `src/ui/workspace/` is the scoped exception zone where `.astro`, `.ts`, and `.tsx` are allowed for the Workspace
  stack; non-Workspace RunWield code remains JavaScript/JSDoc.
- The local server binds to `127.0.0.1` by default. An explicit `--bind <address>` flag may allow `0.0.0.0` or another
  address when the user knowingly wants LAN/container exposure.
- The local server should include a random session token in the opened URL and reject state-changing requests without
  that token. It should path-sandbox filesystem access beneath the launched checkout and should not enable permissive
  CORS by default.
- The v1 local API is REST/JSON over the Workspace server. gRPC is not a good fit for this phase because the UI is
  browser-first and Deno-native, and should avoid generated client stubs. A future remote service can revisit protocol
  choices if REST becomes a real constraint.
- The Plan UI Server and Workspace shell now use Astro SSR in `src/ui/workspace/`. This supersedes the original Fresh
  2/Preact implementation direction.
- React islands own interactive Workspace surfaces, including drag-and-drop, lifecycle controls, search, body editing,
  and review-oriented surfaces.
- Tailwind 4 plus RunWield CSS variables are the current Workspace styling endpoint. This supersedes the original UnoCSS
  prototype direction.
- Radix-compatible RunWield primitives and the RunWield browser design system are the current interaction and visual
  baseline.
- Selective Plannotator reuse is allowed for document, editor, review, and diff surfaces where it fits RunWield
  semantics and theme boundaries.
- The current checkout's `plans/` directory remains the canonical Plan store. The Plan Board must not introduce a
  separate canonical database for v1.
- The Plan Board should be built as a Plan-focused view inside a Workspace-capable shell. The shell does not need to
  expose non-Plan resources in v1, but it should not hard-code navigation, routing, or editor assumptions that make
  future documentation, notes, wiki pages, or project files awkward to add.
- Workspace-capable does not mean Notion clone. RunWield should make Plans and Boards easy to manage and easy to link
  from other tools, rather than trying to replace the team's existing knowledge/project management stack.
- Resource URLs are part of the product surface. Routes should use durable resource identities and readable slugs where
  possible, while preserving a stable opaque Plan identifier so renamed Plans do not break links.
- V1 routing is project-scoped. A local UI server shows the checkout from which it was launched; a hosted/self-hosted UI
  should show one selected project/workspace. A global all-projects URL space is future work.
- Plan IDs should be globally unique so a project-scoped route can be as simple as `/:planId` or `/plans/:planId`
  without relying on title slugs, filesystem paths, or project-relative counters for durability.
- Board view state that users naturally share should be URL-addressable: active/closed screens, status filters, Epic
  child views, selected Plan detail, and possibly search/filter parameters.
- The editor surface should be resource-agnostic. Plan-specific lifecycle controls belong outside the generic editor
  boundary so the same editor foundation can eventually edit Workspace documentation, notes, wiki pages, or other
  markdown resources.
- The frontend should distinguish generic Workspace concepts from Plan-specific concepts. Generic surfaces can include
  navigation, document viewing, document editing, search, and resource opening. Plan-specific surfaces include Plan
  Status columns, Epic hierarchy, Plan Events, Workflow Validation semantics, and lifecycle controls.
- The local data adapter should be Plan-specific in v1 but should sit behind a boundary that can later gain additional
  resource adapters. Future adapters might read documentation from project docs directories, meeting notes from a notes
  directory, or project knowledge pages from another local source without changing Plan Lifecycle code.
- The Plan UI Server exposes a local API over the existing Plan store and Plan Lifecycle seams:
  - list Plans and grouped Epic hierarchy
  - read a Plan's Front Matter and markdown body
  - save a Plan markdown body while preserving Front Matter
  - record Plan lifecycle/manual status actions
  - list child FEATURE Plans for an Epic
  - surface worktree and dependency metadata as read-only detail fields
- This archived PRD captures the completed v1 behavior. Current reality docs and source now reflect the lifecycle
  support that landed in code.
- The Plan Board should be custom RunWield UI backed by Plan adapters and lifecycle APIs. It should not be implemented
  as an AFFiNE, BlockSuite, Plannotator, or editor-owned database board.
- The Plan Board should use the same grouping semantics as existing Plan listing behavior: Epics are top-level
  containers, child FEATURE Plans are discovered through `parentPlan`, and orphaned child FEATURE Plans are visible as a
  separate exceptional group.
- The main board defaults to top-level Plan Cards. Child FEATURE Plans appear inside an Epic detail view unless the user
  explicitly expands or filters for child Plans.
- The active screen contains ordinary work statuses. The closed screen contains terminal work statuses. On-hold Plans
  are visually separated because `on_hold` means paused-but-resumable, not done.
- Plan Card click behavior is read-first. Editing is available through a prominent detail action and a direct card-menu
  shortcut.
- The Plan Editor owns the markdown body only. It does not expose raw Front Matter editing as the default path.
- The Plan Editor writes to disk only on explicit Save. Browser-local draft recovery may be used for unsaved body edits,
  but those drafts are not canonical Plan state.
- Structured controls own workflow-critical Front Matter changes. Status movement must go through Plan Lifecycle or
  explicit manual lifecycle helpers.
- Board drag-and-drop may be immediate for status movement, but it must call lifecycle APIs instead of writing YAML
  fields directly.
- Add manual lifecycle support for user-driven status movement without falsifying workflow events. A generic
  `manual_status_change` event can cover reversible board movement among non-terminal, non-failed statuses.
- Add a terminal `closed_without_verification` Plan Status for Plans the user manually accepts, verifies outside
  RunWield, or chooses not to run through Workflow Validation. This status is distinct from `verified`, `on_hold`, and
  physical archival.
- `verified` remains reserved for Workflow Validation success, except for the existing Epic done-enough exception.
- `failed` remains a mechanical recovery state. Entering or leaving `failed` should require recovery-specific actions,
  not casual board drag-and-drop.
- Manual moves into `in_progress` and `implemented` are allowed because the user may start or finish work outside
  RunWield.
- Moving a Plan into `implemented` does not automatically prompt for Workflow Validation in v1.
- The first implementation should not adopt AFFiNE-the-app as the Plan Board. AFFiNE is useful prior art, but it brings
  its own product, account, deployment, and storage assumptions.
- The production editor path now uses Workspace document/editor surfaces with selective Plannotator reuse, behind the
  Plan body editing boundary. Rich-editor technology remains replaceable and must not own Plan Board or Plan Lifecycle
  semantics.
- The earlier BlockSuite spike remains useful historical research, but BlockSuite was not adopted as the production Plan
  editor path. Production save semantics are enforced through Plan body APIs and body hashes.
- y-octo and OctoBase are not v1 dependencies. y-octo is promising for future Yjs-compatible collaboration. OctoBase is
  excluded from v1 because its current license and maturity do not fit RunWield's need to keep distribution controlled.
- Remote encrypted collaboration remains future work. When revisited, all Plan content and metadata intended for remote
  storage should be encrypted client-side; the server should store as little unencrypted metadata outside encrypted
  Front Matter as possible.

## Testing Decisions

- Test from the highest stable seams: local Plan UI Server API behavior, Plan Lifecycle behavior, and browser-level Plan
  Board flows.
- Plan listing tests should assert that the local API returns the same Plan hierarchy concepts as the CLI listing:
  Epics, child FEATURE Plans, standalone Plans, and orphaned children.
- Plan body save tests should assert that saving editor content changes only the markdown body and preserves Front
  Matter unless a structured lifecycle action is invoked.
- Structured Front Matter control tests should assert that status, dependencies, parent Plan, and Epic metadata are
  validated through existing Plan persistence and lifecycle helpers.
- Manual lifecycle tests should assert allowed board moves:
  - draft or feedback to ready-for-work
  - ready-for-work to in-progress
  - in-progress to implemented
  - implemented to closed-without-verification
  - non-terminal statuses to on-hold where the on-hold PRD allows it
- Manual lifecycle tests should assert blocked or gated moves:
  - any FEATURE Plan directly to verified
  - casual movement into failed
  - casual movement out of failed without recovery
  - on-hold resume without the Resume Check path once on-hold behavior is implemented
- Plan Board browser tests should cover:
  - `wld plans ui` launches a local URL
  - active board status columns render
  - Plan Card click opens read-first detail
  - Edit opens the Plan Editor
  - Save persists body edits
  - drag-and-drop records a lifecycle/manual status action
  - Epic cards show child progress and open an Epic detail view
  - closed screen separates verified from closed-without-verification
- Workspace-readiness tests should assert that Plan Board routes and APIs are Plan-specific where they need to be, while
  generic shell components are not coupled to Plan Status or Plan Lifecycle.
- Editor fidelity tests should use real Plan markdown fixtures and assert markdown round-trip behavior for headings,
  code fences, tables, task lists, links, Front Matter boundaries, and long-form sections.
- Editor fidelity tests should reject silent canonical-body rewrites. If an editor adapter injects a synthetic title,
  changes list markers, normalizes whitespace, or otherwise rewrites markdown, the save path must either compensate
  deliberately or fail loudly.
- Editor integrations should be tested behind the Plan body/editor boundary. Tests should prove that replacing a
  document editor does not affect Plan Board lifecycle, top-level board UI, or persistence behavior.
- No remote encryption, remote API, or database tests are required for this PRD because those are out of scope.

## Out of Scope

- Replacing markdown Plan files as the canonical Plan source.
- Making AFFiNE-the-app the RunWield Plan Board.
- Making BlockSuite's native database/Kanban blocks the RunWield Plan Board.
- Adding a v1 database for local Plan management.
- Adopting OctoBase as a v1 dependency.
- Building hosted or self-hosted encrypted collaboration.
- Building real-time collaborative editing.
- Building the broader Workspace information architecture beyond the Plan Board shell.
- Building first-class project documentation, wiki pages, project files, or meeting notes in v1.
- Building a Notion clone or replacing users' existing Slack/Jira/Notion/GitHub/docs workflows.
- Building comment threads or inline annotations.
- Building notifications.
- Building a remote multi-user account model.
- Building a global all-projects Plan dashboard or super-URL space.
- Building full Plan archival or search over archived Plans.
- Automatically running Workflow Validation after a manual move to implemented.
- Letting FEATURE Plans become verified without Workflow Validation.
- Allowing raw Front Matter editing as the default Plan editing experience.

## Further Notes

This PRD intentionally separates four concerns that are easy to blur:

- Local Plan management: browser UI over canonical markdown files in the checkout.
- Rich editing: Workspace document/editor surfaces embedded behind a replaceable Plan body boundary.
- Remote collaboration: encrypted Plan Spaces from the collaborative planning direction.
- Broader Workspace: future project knowledge surfaces that can live beside Plans.

The local Plan Board should be useful even if rich editing starts with a conservative editor. The dangerous part is not
the board; it is letting a rich editor quietly rewrite Plans in a way Planner, Architect, Slicer, or `load-plan` cannot
understand. Markdown fidelity is therefore a product requirement, not just an implementation detail.

The closed-without-verification status is a companion to the Plan Board. Once users can manage Plans visually, they need
a terminal state for work they accepted outside RunWield without weakening the existing meaning of verified.

The broader Workspace direction should influence boundaries, not scope. The v1 product is still the Plan Board. The
implementation should simply avoid choices that would make a later docs/wiki/notes/project-files space feel bolted on.

The board layer should stay boring and owned by RunWield. Rich document editors can be powerful inside detail panes,
Plan bodies, notes, documentation, and future Workspace resources, but Plan status columns and lifecycle transitions are
product workflow, not document-editor content.

## Prototype and Implementation Result

The original throwaway Fresh prototype was absorbed and removed. Its useful conclusions were superseded by the
production Workspace implementation and by the 2026-07 ADR amendment. Current reality is:

- `wld plans ui` launches a token-protected, cwd-scoped local Workspace through `src/cmd/plans/ui.js`.
- Production Workspace code lives under `src/ui/workspace/`.
- Astro owns SSR routes and pages.
- React islands own interactive Plan Board behavior, including search, drag-and-drop, lifecycle actions, body editing,
  draft recovery, and review-oriented surfaces.
- Tailwind 4, RunWield CSS variables, Radix-compatible primitives, and the RunWield design system are the current
  browser UI baseline.
- Plan files remain canonical markdown. `planId` provides durable Plan identity for shareable Workspace URLs.
- Plan body editing uses save-only body APIs with body hashes so Front Matter remains protected unless structured
  lifecycle controls are invoked.
- The top-level Plan Board remains custom RunWield UI. Plannotator is reused selectively inside document/editor/review
  boundaries and does not own Plan Lifecycle semantics.
- `closed_without_verification`, `on_hold`, manual lifecycle events, Plan body save APIs, Plan resource identity, closed
  and on-hold screens, Epic progress, and detail views are implemented in source.
- Completion and verification are recorded in the Workspace Plan UI and Astro/React/Plannotator migration work records.
