# UX Design Reference

Use this reference when a frontend change affects what a user reads, understands, enters, waits for, recovers from, or
operates by keyboard or assistive technology. Keep UX decisions attached to the user's recognizable goal and to the
project's existing interaction language.

## User goal and information hierarchy

- State the user's concrete job in product terms before changing the flow: what they are trying to accomplish, what they
  already know, and what outcome confirms success.
- Put primary information and actions where the existing product teaches users to look first.
- Separate primary, secondary, destructive, and navigation actions through the project's existing hierarchy and labels.
- Keep the user's current context visible through transitions: selected item, filters, scroll position, input draft,
  route context, and modal/drawer state.

## Interface copy and action naming

- Use plain, specific copy that names the user's object and action: "Archive project" beats "Submit" when archiving is
  the action.
- Keep action names consistent across labels, confirmations, toasts, headings, empty states, and errors.
- Put guidance close to the control or state it explains. Avoid generic success/failure phrasing when the product can
  say what happened and what the user can do next.
- When the project localizes copy, write strings so translators get complete phrases and stable interpolation points.

## Data, async, and recovery states

- Design loading, stale/revalidating, empty, error, success, disabled, pending, optimistic, rollback, and
  duplicate-action states for every affected async path.
- Preserve layout stability while data loads and preserve user input or selections when requests fail or refresh.
- Surface failures near the action or content that caused them, with retry, undo, edit, or contact paths when the
  product pattern supports them.
- Make success visible enough to confirm the user's action without interrupting the next task unnecessarily.

## Forms

- Use native form semantics where possible: `form`, `label`, `input`, `select`, `textarea`, `button`, `fieldset`, and
  `legend` before custom controls.
- Provide explicit labels, helper text, input modes, autocomplete, required/optional cues, constraints, and examples
  when they help the user enter valid data.
- Validate at useful times: late enough not to punish normal typing, early enough to prevent avoidable submit failures.
- Associate errors with their fields, make messages actionable, announce submit-level failures accessibly, and preserve
  the user's entered values across failed submits.
- Guard duplicate submissions and keep pending/submitted state understandable at the place the user acted.

## Keyboard and semantic accessibility

- Use buttons for actions, links for navigation, labels for inputs, headings/lists/landmarks for structure, and dialogs
  or menus only when their interaction model matches the UI.
- Preserve tab order, visible focus, Enter/Space activation, Escape dismissal, arrow-key behavior, focus trapping, and
  focus return according to the component type and project conventions.
- Ensure accessible names, descriptions, error associations, and live regions match the visible experience.
- State, priority, error, and selection must not rely on color alone.

## Motion and reduced motion

- Use motion to explain continuity, reveal state change, or focus attention. Keep duration/easing consistent with the
  project.
- Provide reduced-motion behavior for animations that move, zoom, parallax, auto-play, or otherwise distract from the
  task.
- Do not make critical information depend on animation completing.

## Responsive and container behavior

- Design for content and containers, not one viewport. Check narrow, wide, dense, and constrained parent containers that
  the product actually supports.
- Prefer fluid layout primitives and deliberate wrapping/truncation/scrolling over fixed pixel positioning.
- Account for sticky regions, sidebars, modals, popovers, nested scroll areas, virtualized lists, tables, and toolbars.
- Keep primary actions reachable and context visible when the layout compresses.

## Realistic and localized content

- Test long labels, translated strings, user-generated names, empty values, dense lists/tables, IDs, URLs, and unbroken
  strings.
- When truncating, preserve access to the full value through the project's pattern: title, tooltip, detail view, copy
  affordance, expansion, or horizontal scroll.
- Ensure content cannot overlap controls, escape containers, hide required actions, or become unreadable at supported
  sizes.

## UX completion criterion

The branch is complete when the user's goal, primary action, copy, semantics, keyboard path, responsive/content
behavior, all relevant async/form states, recovery path, and context preservation are accounted for in the changed UI or
are not applicable for a named reason.
