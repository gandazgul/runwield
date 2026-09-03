# RunWield Design System

The RunWield Design System is the shared browser UI language for Workspace, Plan Review, Code Review, and future
RunWield web surfaces. Plan Review and Code Review are the visual blueprint. Their compact, tool-like density should
carry through the rest of Workspace.

## Principles

### Use the review surfaces as the blueprint

The visual direction is dark, focused, compact, and workflow-oriented. Keep the strongest parts of Plan Review and Code
Review as the baseline:

- dark page background with layered slate surfaces;
- blue accent for navigational emphasis and primary intent;
- compact rectangular controls with 6px corners;
- squared-off cards and panels with 6–8px corners, subtle borders, and restrained shadows;
- 28px compact toolbar controls and 32px standard controls on desktop;
- 12–14px utility text with larger type reserved for document content and page headings;
- pill geometry only for statuses, counts, and short metadata badges;
- dense but readable spacing that keeps related controls and information in one view;
- direct language that names RunWield workflow concepts rather than generic product metaphors.

Do not copy the old Workspace habit of making every action a pill or every container a large soft card. Rounded corners
communicate containment; they are not decoration. When unsure, copy the density and shape of the review toolbars.

### Prefer semantic UI language

Use semantic names that describe purpose, not raw appearance. Prefer `surface`, `accent`, `danger`, `warning`,
`metadata`, `card`, and `panel` over one-off color or layout names.

When a new pattern appears in multiple places, name it and add it here before it spreads as copied CSS.

### Design for agents as maintainers

Future UI work will often be produced by agents. Components, classes, and documentation should therefore make the
correct choice obvious:

- use stable pattern names;
- keep variants explicit;
- avoid clever styling that requires visual guessing;
- document when to use and not use a pattern;
- keep Workflow and Plan vocabulary aligned with `docs/domain-language.md`.

## Source of truth

Use the current review interfaces as the primary visual reference:

- Plan Review: `src/ui/workspace/react/PlanReviewSurface.tsx` and the `/dev/plan-review` fixture;
- Code Review: `src/ui/workspace/react/CodeReviewSurface.tsx` and the `/dev/code-review` fixture;
- review layout and overrides: `src/ui/workspace/react/plannotator.css`;
- compact shared controls: `.rw-toolbar-button` and `.rw-segmented-toggle` in `src/ui/design-system/components.css`.

The rest of Workspace should reuse that language through these implementation layers:

- CSS baseline: `src/ui/design-system/tokens.css`, `src/ui/design-system/components.css`, and
  `src/ui/workspace/static/workspace.css`
- theme bridge: `src/ui/design-system/theme-bridge.js`
- shell and navigation: `src/ui/workspace/layouts/WorkspaceLayout.astro`
- shared Plan Board page composition: `src/ui/workspace/components/PlanBoardPage.astro`
- board patterns: `src/ui/workspace/components/BoardColumn.jsx`, `PlanCard.jsx`, and `EpicCard.jsx`
- detail patterns: `src/ui/workspace/components/PlanDetail.jsx`
- editor and action islands: `src/ui/workspace/islands/`

When documentation and implementation disagree, inspect Plan Review and Code Review first, then update the shared system
and Workspace so they agree again.

### Canonical density examples

| Pattern                          | Reference                               | Desktop rule                                           |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Compact icon or segmented option | Review toolbar                          | 28px high, 6px radius, 11–12px label                   |
| Standard button, input, or tab   | Workspace navigation and review actions | 32px high, 6px radius, 12–14px label                   |
| Touch-critical control           | Session composer on narrow screens      | 44px minimum height; do not apply this desktop-wide    |
| Card                             | Plan Card                               | 12px padding, 6px radius                               |
| Panel or board column            | Review sidebars and Workspace columns   | 8px radius, 10–16px padding                            |
| Status, count, or short metadata | Review state labels                     | pill radius; never use this shape for ordinary actions |

These values are defaults, not a reason to add `!important`. A specialized interaction may differ when its content or
accessibility behavior requires it.

## Component architecture

RunWield owns its browser UI components. Shared design-system CSS and primitives should live under
`src/ui/design-system/` so Workspace, Plannotator, and future browser surfaces can consume the same visual language. For
Workspace under `src/ui/workspace/`, the supported endpoint is Astro SSR, React islands, and Tailwind 4. Fresh, Preact,
and UnoCSS runtime code is retired for Workspace; remaining Preact/Zag components under
`src/ui/design-system/components/*.jsx` are legacy non-Workspace primitives until a dedicated design-system migration
replaces them.

Workspace surfaces must use RunWield semantic tokens for color, radius, spacing, and status intent. Tailwind utilities
and framework primitives are implementation tools; they should not introduce a competing visual language or bypass
`--rw-*` tokens.

RunWield components should preserve the compact review-surface aesthetic. React primitives may be added under explicit
React paths such as `src/ui/design-system/components/react/`, but RunWield still owns the shell, workflow vocabulary,
variants, and token bridge around them.

Primitive visual components such as buttons, cards, badges, notices, tabs, inputs, and textareas should be
RunWield-owned without a headless interaction dependency unless they require non-trivial keyboard, focus, portal, or
ARIA behavior.

### Shared loaders

Use `RunWieldThinkingDots` for short waiting states such as thinking, sending, refreshing, or loading a compact panel.
It shows a plain label plus three pulsing dots, follows `prefers-reduced-motion`, and uses `--rw-text-muted` by default.
Do not add separate spinners for Session timeline waits.

### Session timeline and control patterns

Session detail surfaces use one ordered timeline for committed history. Live Workspace-owned waits appear as temporary
items and must look different from committed transcript entries. If the server process loses that wait, show the plain
interruption line: “The agent was interrupted. Ask it to continue.” Do not style it as transcript history.

Treat the Session as one continuous work surface. Use dividers, subtle intent rails, and background shifts to
distinguish timeline entries instead of wrapping every message, tool event, workflow stage, and status in a separate
card. The Session summary, stream, composer, and workflow rail should read as adjacent panes. The Session list follows
the same rule: one catalog with compact rows, not a grid of raised Session cards.

Mobile Session composers stay in the normal surface stack, preserve drafts, and keep the primary button touch-sized. The
New Session composer uses a visible screen heading and an empty text field; do not add helper copy or dev/API messages
inside the composer. Dev-only notices belong in a separate shell row above the Session surface.

Busy Sessions stay read-only until the owning surface releases Session Control. Do not show a **Take control** action in
the normal Session shell. Refresh availability and enable the composer automatically when committed state becomes idle.
When the current Workspace owns the running operation, Agent and model controls can accept one pending change and must
show **Applies after this response** until the server commits or clears it. Thinking changes can show immediately when
the Runtime accepts them.

Completed contiguous technical entries can collapse into one chronological **Activity** group after the next Agent
message starts. Expansion must show the original tool names, thinking text, output, and errors. Running or trailing
technical entries stay visible as normal timeline rows.

Session scrolling follows new live content only while the reader is near the live edge. If the reader scrolls away, keep
the viewport stable and show a **Latest activity** action that returns to the live edge.

Messages submitted while another surface owns Session Control remain editable and sendable. Show the sending surface's
small in-memory queue directly above the composer input—not in transcript history—and remove each item when its turn is
accepted after Session Control becomes idle. Workspace keeps this array only in the current browser tab. The TUI uses
the same placement immediately above its editor.

### Session context sidebar

Every persisted Session has one durable context sidebar beside its transcript. Do not show the sidebar for the
unsubmitted New Session composer. The sidebar has three peer tabs in this order: **Workflow**, **Session**, and
**Artifacts**. Default to Workflow when the Session has an active workflow; otherwise default to Session. Preserve the
reader's selected tab while the same Session remains open.

Workflow shows canonical workflow stages and their state, not a second transcript. When the active Plan explicitly
belongs to an Epic, show **Epic** and its name above **Plan** and the child Plan name; omit Epic for standalone Plans.
Session shows durable, user-facing facts such as its name, message and tool-call counts, compaction count, queued
prompts, and context composition. Context composition shows used versus model capacity and splits the used context into
**System & setup** (agent instructions, tools, instruction files, memories, skills, and Project state) versus
**Conversation** (Session chat and provider overhead). Do not expose storage generation or restate that the Session
being viewed is active. In the TUI, do not repeat agent, model, thinking, cost, folder, or branch details from the
footer; the detailed context breakdown may expand on the footer's compact context percentage. Artifacts lists only
explicitly registered, Project-relative Markdown artifacts; never infer an artifact by scraping transcript text. Each
artifact opens in the shared read-only artifact surface and returns to the owning Session.

Use the `.session-context-*` classes and `--rw-*` semantic tokens for the tab rail, fields, workflow rows, and artifact
links. The sidebar is a flat adjacent pane with dividers, not a stack of floating cards. At narrow browser widths it
moves above the transcript without changing its information model.

The TUI uses the same Session projection. Wide terminals show the context pane on the right, pinned to the top of the
visible terminal viewport while transcript blocks scroll independently, and cycle the three tabs with **Ctrl+]**. Its
two-line footer remains full width below both panes. Narrow terminals retain the existing transcript-only layout. If a
TUI user opens an artifact, prefer the configured Workspace reader and fall back to the short-lived local read-only
reader.

## Token model

Workspace already exposes semantic CSS custom properties using the `--rw-*` prefix. Keep this as the public browser UI
token namespace.

### Color tokens

Use existing tokens before adding new ones.

| Token                    | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `--rw-page-bg`           | App background.                                              |
| `--rw-surface`           | Default panel, board column, and nested surface background.  |
| `--rw-surface-raised`    | Cards and prominent panels.                                  |
| `--rw-surface-muted`     | Selected states, counters, badges, and lower-emphasis fills. |
| `--rw-surface-strong`    | Hover states and stronger nested surfaces.                   |
| `--rw-text`              | Default text.                                                |
| `--rw-text-strong`       | Highest-emphasis text.                                       |
| `--rw-text-muted`        | Supporting text.                                             |
| `--rw-text-dim`          | Metadata labels, descriptions, and low-emphasis text.        |
| `--rw-accent`            | Primary accent, focus, active tab underline, primary border. |
| `--rw-accent-strong`     | Strong accent and secondary accent status.                   |
| `--rw-accent-text`       | Accent-colored readable text, links, and titles.             |
| `--rw-border`            | Default border.                                              |
| `--rw-border-strong`     | Stronger border and hover border.                            |
| `--rw-success`           | Successful, verified, or done-enough state.                  |
| `--rw-warning`           | In-progress, implemented, blocked, or caution state.         |
| `--rw-error`             | Failed, missing, denied, or destructive state.               |
| `--rw-code`              | Code and editor accent.                                      |
| `--rw-complexity-low`    | LOW Complexity label.                                        |
| `--rw-complexity-medium` | MEDIUM Complexity label.                                     |
| `--rw-complexity-high`   | HIGH Complexity label.                                       |

### Shape, control, and spacing tokens

| Token                                           | Purpose                                                  |
| ----------------------------------------------- | -------------------------------------------------------- |
| `--rw-radius-control`                           | Buttons, inputs, tabs, and other ordinary controls.      |
| `--rw-radius-card`                              | Cards and nested content blocks.                         |
| `--rw-radius-panel`                             | Board columns, sidebars, dialogs, and larger containers. |
| `--rw-radius-pill`                              | Statuses, counts, and short metadata only.               |
| `--rw-control-height-compact`                   | Review-style compact toolbar controls.                   |
| `--rw-control-height`                           | Standard desktop controls.                               |
| `--rw-space-control-x` / `--rw-space-control-y` | Standard control padding.                                |
| `--rw-space-card`                               | Card padding.                                            |
| `--rw-space-panel`                              | Page-edge and panel padding.                             |

Shared CSS owns a border-box reset so declared control heights include borders and padding. Without it, a nominal 32px
control can render much taller. Do not override this reset locally.

The browser design system must share the active theme with the TUI. The shared design-system module owns the browser
theme bridge at `src/ui/design-system/theme-bridge.js`, which maps the active RunWield TUI theme into these variables.
New browser surfaces should consume the generated variables; they should not read theme JSON directly.

Shared CSS should be split by responsibility rather than kept as one broad `styles.css` file:

- `tokens.css` for base CSS variables, resets, typography defaults, and theme-derived token usage;
- `components.css` for reusable design-system primitives such as actions, cards, badges, notices, forms, metadata,
  dialogs, and editor/markdown surfaces;
- surface-specific CSS, such as `workspace.css`, for layouts and patterns that are not yet shared across browser
  surfaces.

### Adding tokens

Only add a token when an existing semantic token cannot describe the intended use. New tokens should be:

- prefixed with `--rw-`;
- semantic rather than literal;
- documented in this file;
- mapped in `src/ui/design-system/theme-bridge.js` when they should respond to user themes;
- used by at least one real pattern.

Avoid component-specific tokens until a component genuinely needs stable customization across surfaces.

## Layout patterns

### Workspace shell

Use the shell pattern for full-page browser surfaces:

- centered wide container that lets workflow boards use the viewport;
- 16px desktop page padding, reduced only when a full-bleed review surface owns the viewport;
- top-left RunWield brand link;
- tabbed or action-based navigation below the header;
- main content below navigation.

The shell should feel like a local tool, not a marketing site. Avoid large hero sections, decorative imagery, and sparse
SaaS-dashboard layouts.

### Tabs

Use tabs for peer workspace views, such as active, closed, and on-hold Plan groupings.

Tab rules:

- use compact 32px rounded rectangles inside a thin bordered tab bar;
- use the control radius, never the pill radius;
- active tabs use `--rw-surface-muted`, strong text, and an inset accent marker;
- hover states use `--rw-surface-strong` and stronger borders;
- tabs may include a trailing utility slot, such as search, when it filters the current view.

Do not use tabs for one-off actions. Use action buttons instead.

### Action controls

Use `.primary-action`, `.secondary-action`, and `.danger-action` for ordinary actions across Workspace and review
surfaces. These classes are defined only in `src/ui/design-system/components.css`; feature stylesheets may add layout
classes but must not redefine their shape, color, type, hover, or focus behavior. Do not introduce reversed aliases such
as `.action-primary`; one vocabulary keeps markup and visual behavior searchable.

React surfaces should use `RunWieldButton` for state-changing actions and `RunWieldLink` for navigation styled as an
action. `RunWieldButton` defaults to `type="button"`; submit controls must opt into `type="submit"`. Do not turn an
anchor into a button handler or use placeholder fragment URLs for actions that do not exist.

### Toolbar controls

Use `.rw-toolbar-button` for compact actions inside Workspace toolbars. This class is shared in
`src/ui/design-system/components.css` so related actions keep the same size, border, text color, hover state, and
disabled state. Use it for toolbar actions that open side panels, switch helper views, or add comments. Do not make
one-off local button styles for those actions.

Use `.rw-segmented-toggle` for compact toolbar choices such as `Changes` / `Files`, `Side by side` / `Unified`, Plan
mode choices, and settings choices. Each option must include an icon, a label in a `<span>`, and a `title` that matches
the label. Active buttons can use `.active`, `aria-pressed="true"`, or `aria-selected="true"`. The active option shows
its label. Inactive options stay icon-only. Hover changes the icon/button color and the browser tooltip shows the label;
hover must not expand labels.

Use the Plan comment modal as the canonical modal composer style. Use `.rw-modal-primary-button` for the main action.
Put keyboard help such as `⌘↵` or `Ctrl+Enter` to the left of that button with `.rw-modal-submit-hint` when the action
has a keyboard shortcut. Use `.rw-modal-textarea` for modal/composer textareas that must match the shared comment input
size, blue border, focus ring, and surface.

Use the **Review action button** pattern for a prominent safe action in Plan Review, Code Review, and read-only review
surfaces. The CSS hooks are `.rw-review-action` for wrappers around Plannotator buttons and `.rw-review-action-button`
for native buttons. Use it for actions such as **Send Annotations** or **Close** when the action must stay easy to find
inside the review surface. Do not use it for destructive outcomes or low-emphasis toolbar controls.

Use the **Artifact conversation** pattern when the active workflow agent can discuss and revise the artifact without
leaving its review surface. Render `ArtifactConversationSidebar` inside an existing review sidebar, keep its message and
operation wiring in the owning surface, and use the shared `.rw-artifact-conversation-*` classes. Review context is
attached explicitly as a removable chip; ordinary final feedback actions remain separate. Only one agent turn may be
active at a time. When a revised artifact arrives, replace the readable artifact in place and open a before/after diff
automatically. The component is artifact-neutral so Plan Review, Code Review, and later review surfaces can share the
same transcript, composer, working, and error states.

### Boards and columns

Use board columns for status-grouped workflow objects.

A board column contains:

- a bordered `--rw-surface` panel;
- a header with label, description, and count pill;
- a vertical stack of cards;
- a dashed empty state when no cards are present.

Use horizontal overflow when the number of workflow statuses is large. Preserve status order from workflow semantics,
not from visual convenience.

## Surface patterns

### Cards

Cards are the default representation for selectable workflow objects. Use the Plan Card as the canonical card pattern.

A card should include:

- a kicker naming the object role, such as Feature or Epic;
- the object title as accent text;
- a short summary or fallback text;
- badges for important health or dependency states;
- whole-card click affordance when the card opens detail;
- optional drag grip only when drag is allowed;
- 12px default padding and the card radius.

Use the raised surface, small corners, border, and restrained shadow from Workspace. Hover may accent the border; avoid
large lifts or shadows that make dense boards visually unstable. Do not create flat, borderless workflow cards.

### Epic cards

Epic Cards are a specialized Plan Card variant. They should remain visibly related to Plan Cards while signaling that an
Epic is a container:

- use the accent-tinted gradient treatment;
- include child progress;
- show child health badges;
- open Epic detail rather than flattening child FEATURE Plans by default.

### Detail panels

Use detail panels for object inspection and editing. A detail view should have:

- a close or back affordance;
- a title row with status or Complexity labels when relevant;
- primary content in the main column;
- metadata and lifecycle actions in a side column when space allows;
- responsive collapse to one column on narrow screens.

Do not make workflow-critical Front Matter or lifecycle state editable only through raw text. Use structured actions for
workflow-critical changes.

### Dialogs

Dialog is a general modal primitive for browser surfaces that need focused confirmation, short forms, or blocking
workflow decisions. Workspace does not currently provide a source pattern for dialogs, so new dialogs should preserve
the Workspace visual language while using Radix-compatible React behavior for accessibility and interaction behavior.

Dialog should be flexible rather than confirmation-only:

- support yes/no confirmation flows;
- support arbitrary body content for short forms or explanations;
- support flexible footer actions using primary, secondary, danger, or disabled action patterns;
- keep one visually dominant primary or danger action when a decision is required;
- make dismissal behavior explicit when closing the dialog could lose input or skip a workflow decision;
- remain ephemeral by default: opening a dialog should not change the browser URL, and refresh may close it unless a
  future use case explicitly requires a route-backed dialog.

### Pairing code panels

Owner Workspace pairing uses one compact, flat authorization panel. Present it as a two-step sequence: identify the
device and copy the short code, then run the copyable CLI command. Use horizontal dividers and aligned rows rather than
nested cards. The timer belongs directly under the code so its expiration scope is unambiguous.

Use the existing form, primary/secondary action, and status text patterns. The copy command should look like a real
action button, not a plain text link. Never style a pairing code as a long-lived secret; the surrounding copy should
make clear that it is short-lived and replaced automatically.

### Markdown and editor surfaces

Markdown and editor content should sit on the shared document canvas. In a workbench, the canvas may use one quiet
document boundary, but do not place additional rounded containers around each section. Markdown headings use accent
text. Code and editor affordances should follow Workspace editor styling rather than browser defaults.

## Action patterns

### Primary action

Use primary actions for the main safe progression on a surface, such as saving or approving when approval is the normal
next step. Primary actions use the accent fill and dark text.

A page should usually have one dominant primary action.

### Secondary action

Use secondary actions for safe alternatives, navigation, and non-final workflow operations. Secondary actions use the
surface fill, border, and accent text.

### Danger action

Use danger actions for destructive, rejecting, failing, or denial-oriented operations. Danger actions use the error
color family and should not be visually confused with primary progression.

### Disabled action

Disabled actions should remain visible when their absence would hide workflow state. Pair disabled actions with nearby
text that explains why the action is unavailable.

## Status and feedback patterns

### Status pills and badges

Use pill-shaped labels for statuses, health markers, and compact metadata. Status labels and badges should use the same
shape language. Pills are a deliberate exception to the rectangular control language. Do not apply pill geometry to
buttons, links styled as actions, inputs, tabs, search fields, cards, or panels.

Status color intent:

- draft and feedback: muted/default;
- approved, ready for decomposition, ready for work: accent;
- in progress and implemented: warning;
- verified: success;
- failed: error;
- closed without verification and on hold: secondary accent.

Badges should be short. Prefer `Blocked by dependency`, `Missing parent Epic`, `Done enough`, or `Failed child` over
long explanatory text. Put detailed explanations in nearby body copy, metadata, or notices.

### Notices

Use notices for local outcomes and important contextual messages. A notice may be success, muted, warning, or danger,
but the message should explain the consequence in plain language.

## Forms and inputs

Inputs should use dark nested backgrounds, the 6px control radius, 32px desktop height, and explicit focus rings derived
from `--rw-accent`. Search fields use the same geometry as other controls; being inside navigation does not make a field
a pill.

Form labels and helper text should be visible. Do not rely on placeholder text as the only label.

## Metadata patterns

Metadata belongs in grouped definition lists when inspecting a Plan, Epic, review, or workflow object.

Rules:

- group metadata by user task or workflow concept;
- use dim labels and normal text values;
- preserve RunWield vocabulary from `docs/domain-language.md`;
- hide implementation-only values unless they help the user make a workflow decision;
- show unknown or missing metadata only when that absence matters.

Use `.metadata-reference-list` for metadata whose value is an external reference, such as Plan Ticket References. Render
one semantic link per safe `http`/`https` URL, use `target="_blank"` with `rel="noreferrer noopener"`, preserve visible
focus with `--rw-accent`, and allow long unbroken URLs to wrap inside the sidebar. Unsafe or non-HTTP values may be
shown as muted text but must not become clickable.

## Review-surface guidance

RunWield's Plan Review and Code Review surfaces are now the design reference. Preserve their compact toolbar, segmented
controls, thin dividers, full-height working layout, and clear three-pane hierarchy while replacing remaining imported
details with RunWield-owned components over time.

Plan Detail, Plan Review, and read-only Plan are modes of the same Plan workbench. They must share the full-height
review shell, compact title toolbar, document canvas, and pane boundaries. Change the available controls and side-rail
content for each mode; do not give one mode a separate dashboard-detail layout.

When Plan Review is embedded in Workspace, the Workspace main header is its only title and decision bar. Show
`Plan Review — [Plan title]` on the left and the execution-policy controls plus approval action on the right. Begin the
embedded surface directly with the Plan workbench: do not repeat the logo/title/options header or the Project/Session
breadcrumb strip. Reuse the Session screen's `workspace-main-header` height, title alignment, and shell spacing; do not
create review-specific header geometry. Keep one `--rw-space-panel` gap below that shared header before the embedded
workbench begins. Workspace Plan Review defaults to the wide document canvas. Standalone review keeps its compact
launcher header because it has no owner Workspace shell.

Plannotator-specific mapping:

- plan review page: use the shell plus a detail-panel layout;
- Plan title, summary, Front Matter, and markdown body: follow Plan Detail and MarkdownView patterns;
- annotation submission: label the action **Send Annotations** and place it directly below the annotation sidebar
  heading, above the annotation list, using the Review action button pattern so it remains visible;
- approve/save: primary action when it is the normal forward path;
- request changes or deny: danger action when it sends Feedback back to the planning Agent;
- comments and annotations: use badge, notice, and metadata patterns before inventing a separate comment aesthetic;
- code review diffs: use markdown/editor surface rules with strong file and hunk hierarchy;
- review outcome messages: use notices with clear workflow consequences.

Review surfaces share tokens with Workspace. If a review interaction requires a new pattern, add the pattern here first
or in the same change, then consider whether Workspace should reuse it.

## Accessibility and interaction rules

- Preserve visible focus states for all interactive elements.
- Do not encode status by color alone; pair color with text labels.
- Use real links for navigation and buttons for state-changing actions.
- Keep whole-card links accessible with descriptive labels.
- Use `aria-label` or visible headings for board columns and important panels.
- Preserve responsive behavior for narrow screens.
- Avoid hover-only information; keyboard and touch users need the same workflow context.

## Extension checklist

Before adding or changing browser UI, check:

1. Does Plan Review, Code Review, or an existing shared pattern already cover this?
2. Are all colors expressed through `--rw-*` tokens?
3. Are radius, control height, and padding expressed through the shared density tokens?
4. Is pill geometry limited to statuses, counts, or short metadata?
5. Is the pattern named in RunWield domain language?
6. Does the UI preserve the compact review-surface look and feel?
7. Are statuses and workflow consequences visible in text, not just color?
8. Would a future agent know which pattern to copy from this document?

## Non-goals for v1

- No marketing-site design language.
- No large-radius, oversized SaaS-dashboard component language.
- No requirement to extract a full component library immediately.
- No replacement of RunWield theme files with a separate design-token build system.
- No commitment to W3C Design Tokens file format until a real integration needs it.

## Plannotator component reuse exception

Workspace may temporarily host imported upstream Plannotator React/TypeScript components while RunWield validates deeper
collaboration with the Plannotator ecosystem. This exception is scoped to `src/ui/workspace/` and does not by itself
change the rest of RunWield's JS/JSDoc convention.

When imported Plannotator components are used:

- prefer package-style imports such as `@plannotator/ui/components/RenderedMarkdown` through Vite aliases that point at
  a pinned checkout under `third_party/plannotator/`;
- pin and review the upstream commit before updating it;
- preserve RunWield Plan vocabulary, Plan Lifecycle controls, and canonical markdown storage;
- bridge Plannotator/Tailwind-style tokens to RunWield `--rw-*` variables instead of replacing the Workspace visual
  identity in one step;
- use Radix primitives from Plannotator when needed for shared React surfaces, but keep RunWield-owned semantics and
  workflow language around them.

The Plan Board, Plan Review, and Code Review each have one surface body. Shells are explicit presentation concerns:

- `PlanBoardPage.astro` renders the same board, filters, tabs, cards, and empty states with either the compact local
  `wld plans ui` shell or the owner Workspace sidebar shell;
- `PlanReviewSurface` and `CodeReviewSurface` use `presentation="standalone"` for TUI-launched browser windows and
  `presentation="workspace"` when a live Session opens the review in the Workspace shell;
- behavior, payload interpretation, annotations, and decision controls stay in the shared surface. Do not fork a
  Workspace-only copy of either review.

Astro development entrypoints:

- `deno task workspace:dev` starts the development server and opens `/dev`, the catalog for every paired presentation;
- `/` and `/projects/dev-project/plans` compare the local and Workspace Plan Board shells;
- `/dev/plan-review` and `/dev/workspace/plan-review` compare standalone and in-situ Plan Review;
- `/dev/code-review` and `/dev/workspace/code-review` compare standalone and in-situ Code Review;
- `/projects/dev-project/sessions/choose-terraform-folder-name` exercises the Session shell and timeline.

Plan Review fixture variants are linked from `/dev`; fixture pages do not render an additional variant switcher above
the review surface.

The `/dev` routes are fixture-only and return 404 in production. The standalone `/review/plan` and `/review/code` routes
remain the real token-protected TUI launch targets. Live Workspace Plan and Code Review decisions return to the same
Session interaction through owner Workspace endpoints.

## Guided Review Explainer blocks

Guided Review Explainers use the same dark RunWield/Plannotator surface language as the code-review UI, but they read as
one scrollable document rather than a file-tree dashboard. Use a single column with generous section spacing so prose,
callouts, Mermaid diagrams, optional widgets, and live diff blocks form a continuous explanation.

- **Prose** is the default block and should use normal readable line height.
- **Callouts** are bordered cards for definitions, edge cases, risks, or reviewer checkpoints. Do not use color alone to
  communicate severity.
- **Mermaid diagrams** live in bordered diagram cards with a title and optional description. Rendering failures should
  show a local error inside the card without breaking the document.
- **Diff blocks** embed Plannotator's annotatable diff viewer and inherit existing annotation behavior.
- **Widgets** are exceptional. Render generated HTML/CSS/JavaScript in sandboxed iframes with no external network access
  and only explicitly allowlisted local assets. Widgets should explain visual or interactive behavior that prose,
  Mermaid, and diffs cannot explain clearly.

Guided Review generation controls must disclose that generation can use an additional LLM call. When auto-generation
finishes, show a non-stealing **Guided Review ready** affordance instead of switching the reviewer away from plain Diff.

### User Verified status intent

Use the explicit label **User Verified** for `user_verified`. It is a closed/successful lifecycle outcome, but not
proof-bearing RunWield Verified. Badges, buttons, and metadata should reuse existing RunWield semantic tokens for
closed/success states and pair the label with explanatory text such as “verified by the user; Workflow Validation was
not claimed.” Do not add a separate theme or token for this status.

### Workflow progress

Use the workflow progress pattern when a surface must show an ordered RunWield workflow such as execution, Mechanical
Validation, Semantic Code Review, repair, delivery, and completion.

- Render stages as an ordered list with text status and color status. Do not rely on color alone.
- Use `--rw-*` semantic tokens for borders, surfaces, success, warning, error, and accent states.
- Keep the model read-only. Progress views can link to related Plan and Session pages, but they must not advance the
  workflow.
- Long failure text must wrap inside the card and must not create whole-page horizontal overflow.
