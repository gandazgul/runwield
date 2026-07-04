# RunWield Design System

The RunWield Design System is the shared browser UI language for Workspace, Plannotator, and future RunWield web
surfaces. Its v1 goal is to codify the current Workspace look and feel, not redesign it.

Workspace is the source of truth. New browser UI should look like it belongs beside `src/ui/workspace/` unless there is
a deliberate, documented reason to diverge.

## Principles

### Preserve the current Workspace aesthetic

The current visual direction is dark, focused, local-first, and workflow-oriented. Keep that baseline:

- dark page background with layered slate surfaces;
- blue accent for navigational emphasis and primary intent;
- pill-shaped actions, badges, and status labels;
- rounded cards and panels with subtle borders and shadows;
- dense but readable information layout;
- direct language that names RunWield workflow concepts rather than generic product metaphors.

Do not use the design system as an excuse for a visual redesign. Refine inconsistencies, but preserve the recognizable
Workspace feel.

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
- keep Workflow and Plan vocabulary aligned with `CONTEXT.md`.

## Source of truth

The current reference implementation is the Workspace UI:

- CSS baseline: `src/ui/workspace/static/styles.css`
- theme bridge: `src/ui/workspace/server/theme-css.js`
- shell and navigation: `src/ui/workspace/components/AppWrapper.jsx` and `src/ui/workspace/components/Layout.jsx`
- board patterns: `src/ui/workspace/components/BoardColumn.jsx`, `PlanCard.jsx`, and `EpicCard.jsx`
- detail patterns: `src/ui/workspace/components/PlanDetail.jsx`
- editor and action islands: `src/ui/workspace/islands/`

When documentation and implementation disagree, inspect Workspace first, then update the documentation or implementation
so they agree again.

## Component architecture

RunWield owns its browser UI components. Shared design-system components should live under `src/ui/design-system/` so
Workspace, Plannotator, and future browser surfaces can consume the same primitives. The design system should use:

- RunWield semantic tokens for color, radius, spacing, and status intent;
- UnoCSS for utility styling and generated CSS;
- Preact/Fresh components written in pure JavaScript and JSDoc;
- Zag.js state machines only for complex accessible interactions such as dialogs, selects, menus, popovers, tooltips,
  comboboxes, and toasts.

RunWield components should preserve the current Workspace aesthetic and avoid React-only primitive stacks unless a
future spike proves a narrow need.

Primitive visual components such as buttons, cards, badges, notices, tabs, inputs, and textareas should be
RunWield-owned without a headless interaction dependency unless they require non-trivial keyboard, focus, portal, or
ARIA behavior.

Dialog is the first reference example for Zag-backed components. Workspace does not currently use dialogs, so Dialog is
a general primitive for upcoming browser surfaces rather than an extracted Workspace pattern. It should use a Zag state
machine for focus trapping, keyboard behavior, dismissal, and ARIA attributes, while RunWield owns the visual shell,
overlay, panel, title, description, footer, and action styling.

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

The browser design system must share the active theme with the TUI. The shared design-system module should own the
browser theme bridge that maps the active RunWield TUI theme into these variables. Workspace's current
`src/ui/workspace/server/theme-css.js` is the source implementation to move or adapt into `src/ui/design-system/`. New
browser surfaces should consume the generated variables; they should not read theme JSON directly.

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
- mapped in `theme-css.js` when they should respond to user themes;
- used by at least one real pattern.

Avoid component-specific tokens until a component genuinely needs stable customization across surfaces.

## Layout patterns

### Workspace shell

Use the shell pattern for full-page browser surfaces:

- centered max-width container;
- generous page padding;
- top-left RunWield brand link;
- tabbed or action-based navigation below the header;
- main content below navigation.

The shell should feel like a local tool, not a marketing site. Avoid large hero sections, decorative imagery, and sparse
SaaS-dashboard layouts.

### Tabs

Use tabs for peer workspace views, such as active, closed, and on-hold Plan groupings.

Tab rules:

- use pill-like rounded rectangles inside a bordered tab bar;
- active tabs use `--rw-surface-muted`, strong text, and an inset accent marker;
- hover states use `--rw-surface-strong` and stronger borders;
- tabs may include a trailing utility slot, such as search, when it filters the current view.

Do not use tabs for one-off actions. Use action buttons instead.

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
- optional drag grip only when drag is allowed.

Use the raised surface, rounded corners, border, and shadow from Workspace. Hover may lift the card slightly and accent
the border. Do not create flat, borderless workflow cards.

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
the Workspace visual language while using Zag for accessibility and interaction behavior.

Dialog should be flexible rather than confirmation-only:

- support yes/no confirmation flows;
- support arbitrary body content for short forms or explanations;
- support flexible footer actions using primary, secondary, danger, or disabled action patterns;
- keep one visually dominant primary or danger action when a decision is required;
- make dismissal behavior explicit when closing the dialog could lose input or skip a workflow decision;
- remain ephemeral by default: opening a dialog should not change the browser URL, and refresh may close it unless a
  future use case explicitly requires a route-backed dialog.

### Markdown and editor surfaces

Markdown and editor content should sit on darker nested surfaces with borders and rounded corners. Markdown headings use
accent text. Code and editor affordances should follow Workspace editor styling rather than browser defaults.

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
shape language.

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

Inputs should use dark nested backgrounds, rounded borders, and explicit focus rings derived from `--rw-accent`. Search
fields may use pill geometry when placed inside navigation or filtering controls.

Form labels and helper text should be visible. Do not rely on placeholder text as the only label.

## Metadata patterns

Metadata belongs in grouped definition lists when inspecting a Plan, Epic, review, or workflow object.

Rules:

- group metadata by user task or workflow concept;
- use dim labels and normal text values;
- preserve RunWield vocabulary from `CONTEXT.md`;
- hide implementation-only values unless they help the user make a workflow decision;
- show unknown or missing metadata only when that absence matters.

## Plannotator port guidance

The future RunWield-owned Plannotator should conform to this design system rather than preserving the external
Plannotator visual language.

Plannotator-specific mapping:

- plan review page: use the shell plus a detail-panel layout;
- Plan title, summary, Front Matter, and markdown body: follow Plan Detail and MarkdownView patterns;
- approve/save: primary action when it is the normal forward path;
- request changes or deny: danger action when it sends Feedback back to the planning Agent;
- comments and annotations: use badge, notice, and metadata patterns before inventing a separate comment aesthetic;
- code review diffs: use markdown/editor surface rules with strong file and hunk hierarchy;
- review outcome messages: use notices with clear workflow consequences.

Plannotator should share tokens with Workspace. If a Plannotator interaction requires a new pattern, add the pattern
here first or in the same change.

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

1. Does an existing Workspace pattern already cover this?
2. Are all colors expressed through `--rw-*` tokens?
3. Is the pattern named in RunWield domain language?
4. Does the UI preserve the current Workspace look and feel?
5. Are statuses and workflow consequences visible in text, not just color?
6. Would a future agent know which pattern to copy from this document?
7. If this is for Plannotator, does it conform to Workspace rather than external Plannotator styling?

## Non-goals for v1

- No visual redesign of Workspace.
- No marketing-site design language.
- No requirement to extract a full component library immediately.
- No replacement of RunWield theme files with a separate design-token build system.
- No commitment to W3C Design Tokens file format until a real integration needs it.
