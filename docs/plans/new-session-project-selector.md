---
planId: "266cb9df-e989-47c4-b2fd-9f55c17875ab"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/pages/projects/[projectId]/sessions/new.astro"
    - "src/ui/workspace/static/workspace-shell.ts"
    - "src/ui/workspace/static/workspace-styles/session-composer.css"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "src/ui/workspace/workspace-shell-navigation.test.ts"
    - "docs/prd/runwield-workspace-prd.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-27"
origin: "internal"
status: "ready_for_work"
userVerifiedAt: null
---

# New Session Project Selector

## Context

New Session currently uses the Project in its URL without a visible Project control. This is hard to check or change on
a phone with the navigation sidebar closed.

The owner confirmed that the selector is temporary: it belongs to New Session before the conversation starts, not to an
existing Session. The default is the current or last-opened Project in this browser, not activity across devices. The
owner also ruled out changing Project after typing; this change does not transfer drafts between Projects.

The owning capabilities are [Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions) and
[Project access and navigation](../prd/runwield-workspace-prd.md#project-access-and-navigation).

- **Add:** a visible, temporary Project choice before starting a Session.
- **Preserve:** registered-Project access limits, browser-local navigation defaults, Project-scoped drafts, failed-send
  recovery, and Project-specific Agent/model defaults.
- **Remove:** no existing capability. Existing Session Project identity remains fixed.

## Objective

Show a Project selector above the New Session composer. Use the existing default Project, allow another available
registered Project while the composer is empty, and remove the selector when the first message creates the Session.

Typing or attaching an image disables Project changes. There is no Project-switch control on an existing Session.

## Approach

**Keep the route as the Project source of truth.** Selecting a Project navigates through the existing Workspace router
to that Project's New Session route. A fresh Session surface loads its options and its own draft. Do not introduce a
second Project identity in component state or change the create API.

```text
New Session link
  current enabled Project → last-opened enabled Project → first enabled Project
  /projects/:projectId/sessions/new
    Project selector → navigate to another Project's New Session route
    type or attach → Project choice disabled
    send → POST /api/owner/projects/:projectId/sessions
    accepted message → selector removed → existing Session route
```

`workspace-shell.ts` already owns the default order and remembers Project visits. Preserve that behavior, including
explicit Project links and the `/projects` destination when none are available. Do not add another last-Project storage
key or redirect an explicit Project URL to the remembered Project.

Read choices from `GET /api/owner/projects`. Use its `enabled` field; it already combines registration and root health.
Use Project display names with the existing safe root label where needed to distinguish entries. Do not accept arbitrary
directories.

Use a labeled native select with `.rw-toolbar-select`, placed directly above the composer and aligned to its width. Keep
it visible while the composer is collapsed. It is disabled while the draft loads, text or images are present, an image
is being read, navigation is pending, or a create request is pending or unresolved. A restored draft follows the same
rule. Guard the change handler as well as the control.

Hide the control after acceptance even if creation returns an operation ID before a Session ID. An uncertain network
result must not unlock Project changes or permit the original request to be retried under another Project. A rejected
request retains its draft and the original Project.

Navigating instead of mutating `projectId` in place avoids mixed draft-instance IDs and old Project options. During
navigation, prevent typing and sending in the outgoing surface. The destination must finish draft and options loading
before Send is available. Ignore responses from a surface that is no longer current.

The current `workspaceNavigate` event does not report navigation failure. Extend its internal event handling only as
needed to let this caller observe completion or failure from Astro's `navigate` promise. On failure, restore the
original empty composer and choice. Existing navigation callers must retain their current behavior; do not add timers or
a separate routing layer.

The alternative—moving an in-progress draft and its settings between Projects—adds storage and retry rules that the
owner explicitly excluded.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/islands/SessionSurface.jsx` — Project choices, empty-draft change guard, navigation state, loading
  safety, and removal after acceptance.
- `src/ui/workspace/pages/projects/[projectId]/sessions/new.astro` — confirm the Project route mounts a fresh surface;
  change only if needed to enforce that identity.
- `src/ui/workspace/layouts/WorkspaceLayout.astro` — report selector navigation failure through the existing internal
  navigation event so the outgoing form cannot stay locked.
- `src/ui/workspace/static/workspace-shell.ts` — preserve the existing default and remembered Project behavior; no
  parallel preference owner.
- `src/ui/workspace/static/workspace-styles/session-composer.css` — compact selector placement, responsive width, and
  touch target using semantic tokens.
- `src/ui/workspace/workspace-session-ux.test.tsx` — rendered control, navigation, draft protection, loading, and
  request lifecycle coverage.
- `src/ui/workspace/workspace-shell-navigation.test.ts` — default order and remembered choice coverage.
- `src/ui/workspace/server/dev-owner-fixtures.ts` and associated development API fixtures — provide two selectable
  Projects for browser verification if the current single-Project fixture cannot exercise the flow.
- `docs/prd/runwield-workspace-prd.md` — add the requirement and acceptance scenarios under Browser Sessions; reference
  the existing Project access rules.
- `docs/design-system.md` — document this New Session use of the existing compact select pattern.

No server schema, TUI, Session ownership, or cross-device preference change is needed. Project and Session retain their
current glossary meanings; no domain-language change is required.

## Reuse Opportunities

- `workspaceNavigate` and the `runwield:workspace-navigate` listener in `WorkspaceLayout.astro` — existing client
  navigation, with the sidebar retained.
- `ensureSidebarScaffold` and `rememberCurrentRoute` in `static/workspace-shell.ts` — authoritative default order and
  browser-local Project memory.
- `sessionDraftKey`, `sessionAttachmentsKey`, `sessionRequestKey`, and `getNewSessionDraftInstanceId` — existing
  Project-scoped draft and request identity.
- `browser/session-drafts.ts` — existing text/image persistence; do not migrate or transfer drafts.
- `serializeOwnerProject` in `server/owner-projects.js` — existing selectable Project data and safe labels.
- `.rw-toolbar-select` in `src/ui/design-system/components.css` — native select styling, disabled state, and visible
  keyboard focus.

## Implementation Steps

1. **New Session shows the actual route Project.** `SessionSurface` renders a labeled Project select above the composer
   only in new mode before acceptance. Available choices come from the owner Projects endpoint. Loading, read failure
   with Retry, and no available Projects have clear states; no available Projects links to Projects. Do not silently
   choose another Project when a draft is present or its Project becomes unavailable.
2. **An empty composer can change Project without mixed state.** The selector uses `workspaceNavigate` to the selected
   Project's New Session URL, with the existing route handling remounting the surface. The URL, selected label, shell
   memory, draft keys, session options, and later create endpoint all refer to that Project. The outgoing composer
   cannot accept input during navigation. Failed navigation restores its controls with the original Project intact. A
   destination draft is restored, not overwritten.
3. **Project choice follows the message lifecycle.** Both the select and its handler reject changes while text/images
   exist, draft restoration or image reading is incomplete, or creation is pending or unresolved. On accepted creation,
   the select disappears even while waiting for the Session ID. Existing Session detail mode never renders it.
   Network-error retry and HTTP 422 recovery retain the original Project and existing request semantics.
4. **Project-specific controls are ready before Send.** In new mode, Send remains unavailable until the current
   Project's options and draft are loaded and its Project is selectable. Old or unmounted requests cannot install
   another Project's defaults or choices. Option-read failure has a retry path. Existing Agent changes still reset model
   and Thinking to that Agent's defaults, and default selections are not sent as explicit overrides.
5. **Responsive layout preserves the existing composer.** The selector remains visible above the collapsed composer,
   fits narrow screens and long Project names, has a 44px touch target on phones, and uses existing semantic tokens.
   Existing Session composition, keyboard behavior, image previews, and sidebar controls are unchanged.
6. **Behavioral tests prove selection affects creation.** Extend the current React/browser tests to choose Project B
   from Project A, observe navigation, mount the destination, send its first message, and assert that only B's create
   endpoint receives the request with B's defaults. Cover the guards, accepted-operation state, restored drafts, and
   default order described below. Do not replace these checks with static markup or source-text checks alone.
7. **Product guidance matches the delivered behavior.** Update the Browser Sessions requirement and scenarios and the
   design-system usage note in the same change. Preserve unrelated PRD content and unmet targets. No architectural
   decision record is required because route identity, registration authority, and Session creation contracts do not
   change.

## Approval Confirmation

No Work Records are proposed for replacement.

## Verification Plan

**Automated:** run focused tests through the safe test runner, never `deno test` directly:

```sh
deno run -A scripts/run-tests.js --isolated \
  src/ui/workspace/workspace-session-ux.test.tsx \
  src/ui/workspace/workspace-shell-navigation.test.ts \
  src/ui/workspace/session-continuation.integration.test.ts
```

Required behavior checks:

- Current enabled Project wins over remembered Project. From a global page, remembered enabled Project wins over the
  first available Project. Stale memory falls back to an enabled Project; none leads to Projects. An explicit New
  Session URL keeps its Project.
- A rendered Project change from A to B navigates to B. B's options and Project-scoped draft load; sending creates
  through B's endpoint, never A's. The test must fail for a cosmetic dropdown, a no-op change handler, or a selector
  that leaves creation bound to A.
- Text, whitespace text, attached images, image-reading, and restored drafts prevent switching. Clearing unsent input
  can restore the empty-composer choice only when no unresolved request exists. A destination's saved draft and images
  remain intact and disable switching.
- No Send during incomplete Project/options/draft loading. Delayed responses from A cannot replace B's options. Read
  failure shows Retry without clearing a draft or falling back silently. Failed Project navigation restores A's empty
  composer and selector; it never enables creation under B while A remains mounted.
- Pending creation prevents changes. Acceptance with only an operation ID removes the selector. Acceptance with a
  Session ID reaches B's detail route without a selector. An unresolved network failure keeps retry bound to B; a 422
  retains the editable draft in B.
- Disabled, unavailable, and removed Projects cannot be chosen. Project-list failure is not treated as an empty list.
  One available Project remains visibly identified.

Keep existing coverage for image/draft recovery, request deduplication, Agent defaults and overrides, and Session detail
navigation. No existing protected behavior is meant to stop; only changing Project through the new control is restricted
by the new empty-composer rule.

**Headed browser:** start `deno task workspace:dev` in the execution worktree. Use an isolated
`agent-browser --headed --session new-session-project-selector-<worktree-id>` session at `http://127.0.0.1:5173`, with
two available development Projects.

1. At 1440×1000 and 390×844, visit Project A, then use New Session with the sidebar closed. Confirm A is visible above
   the collapsed composer. Use the keyboard and touch control to choose B; check the URL, label, and settings.
2. Type a message, attach an image, and confirm Project choice is disabled. Refresh to confirm restored input remains in
   B. Clear unsent input and switch back to A; confirm B's draft was not moved to A.
3. Send in B and inspect network requests: creation targets B. Confirm the selector disappears on acceptance and is
   absent after refresh on the created Session. If development creation is simulated, label that evidence; the existing
   continuation integration suite supplies real service-boundary coverage.
4. Check long names, loading, failed reads, and an unavailable Project. Confirm there is no horizontal page scroll,
   clipped control, or hidden Send action with the phone keyboard open. Inspect console errors and capture
   desktop/mobile screenshots.

Confirm the PRD scenarios describe the delivered selector rules without claiming cross-device defaults or Project
changes within existing Sessions.

## Edge Cases & Considerations

- **Empty means no draft text and no images.** Whitespace also locks the choice. Clearing all unsent content restores an
  empty composer, but never unlocks an unresolved create request.
- **Saved destination draft:** opening another Project can restore its own draft. This is existing behavior, not a draft
  transfer.
- **Invalid explicit Project URL:** show unavailable state and allow a valid choice only when the composer is empty. Do
  not rewrite or send saved content to another Project.
- **Browser storage restrictions:** preference storage remains best effort. Explicit route identity and the current
  draft remain usable without a new persistence requirement.
- **History:** use existing Workspace navigation conventions for Project selection; successful creation still replaces
  the New Session route.
- **Scope:** no draft transfer, existing-Session Project reassignment, cross-device last-activity tracking, new
  registration flow, or composer redesign.
- **Existing worktree changes:** unrelated edits are present, including in the Workspace PRD. Preserve them and make
  targeted changes only.
