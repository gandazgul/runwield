---
planId: "24d8eefb-a688-4559-8519-33b123a3eb49"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace compiled Plannotator plan/code review launch surfaces with Workspace-hosted Astro/React/Plannotator routes behind the existing review-launcher adapter. Preserve workflow decision behavior while keeping direct HMR dev commands for visual testing and iteration."
affectedPaths:
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/submit-plan.js"
    - "src/shared/workflow/code-review.js"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/routes/api/handlers.js"
    - "src/ui/design-system/theme-bridge.js"
    - "deno.json"
    - "third_party/plannotator/"
frontend: true
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-07T18:01:43.370Z"
updatedAt: "2026-07-09T00:08:24.350Z"
status: "implemented"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 3
dependencies:
    - "01-astro-react-workspace-platform-and-review-dev-entrypoints"
    - "02-core-workspace-astro-react-parity-and-fresh-retirement"
failureReason: "Semantic validation did not approve after 3 cycles."
worktreeId: "fcde4e03"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-workspace-astro-react-plannotator-migration-03-w-fcde4e03"
worktreeBranch: "runwield/worktree/workspace-astro-react-plannotator-migration-03-w-fcde4e03"
worktreeBaseBranch: "workspace-astro-react-plannotator-migration"
worktreeStatus: "validation_failed"
---

# Workspace Hosted Plan and Code Review Surfaces

## Context

RunWield's plan and code review workflows currently launch a compiled Plannotator Node.js HTTP server
(`@gandazgul/plannotator-pi-extension-compiled/server`) that serves a static HTML shell and handles approval/feedback
decisions through its own HTTP endpoints. The caller's `review-launcher.js` adapter starts that server, opens the URL in
the browser, and awaits `waitForDecision()` which resolves when the user clicks approve/feedback/exit.

The Workspace Astro/React migration (plans 01 + 02) now provides an Astro SSR platform with React islands, Tailwind 4,
Radix primitives, and pinned Plannotator UI components under `third_party/plannotator/packages/ui/`. The
`ReviewDevSurface` fixture page exists on the workspace branch as a first scaffold. The compiled Plannotator server
remains in node_modules as a reference.

This slice replaces the compiled server with Workspace-hosted routes that serve the same review UIs using pinned
Plannotator components, backed by local API endpoints for decision transport, behind the unchanged `review-launcher.js`
adapter seam.

## Compiled Server Contract (must replicate)

Discovered by auditing `node_modules/@gandazgul/plannotator-pi-extension-compiled/dist/server.mjs`:

### Plan Review (`startPlanReviewServer`)

- **Input:** `{ plan: string, htmlContent: string, origin?: string, permissionMode?: string, ... }`
- **HTML:** Compiled `plannotator.html` (served at `/`)
- **Endpoints:**
  - `POST /api/decision` — body
    `{ approved: true, feedback?, agentSwitch?, permissionMode?, obsidian?, bear?, octarine?, planSave? }` → resolves
    `waitForDecision()` with `{ approved: true, feedback, savedPath?, agentSwitch?, permissionMode? }`
  - `POST /api/deny` — body `{ feedback?, planSave? }` → resolves `waitForDecision()` with
    `{ approved: false, feedback }`
- **Return:**
  `{ url, port, waitForDecision(): Promise<PlanReviewDecision>, stop(): void, onDecision(listener), reviewId }`

### Code Review (`startReviewServer`)

- **Input:** `{ rawPatch: string, gitRef: string, htmlContent: string, origin?, agentCwd?, diffType?, ... }`
- **HTML:** Compiled `review-editor.html` (served at `/`)
- **Endpoints:**
  - `POST /api/feedback` — body `{ approved: boolean, feedback: string, annotations: array, agentSwitch? }` → resolves
    `waitForDecision()` with same
  - `POST /api/exit` — body `{}` → resolves `waitForDecision()` with
    `{ approved: false, feedback: "", annotations: [], exit: true }`
- **Return:** `{ url, port, waitForDecision(): Promise<CodeReviewDecision>, stop(): void, ... }`

The current `review-launcher.js` wrapper expects any surface to return `{ url, waitForDecision, stop }`. The
Workspace-hosted replacement must return the same shape.

## Objective

Replace the compiled Plannotator server launch with Workspace-hosted Astro/React/Plannotator review surfaces that match
the Plannotator visual interface as closely as possible, while removing RunWield-irrelevant features.

### Plan Review Surface — required features (in priority order)

The layout must match Plannotator's plan review interface: Viewer/MarkdownEditor in the main pane, left sidebar with
Contents/Outline (no Files or Archive tabs), annotations sidebar with toggle on the right in the same position
Plannotator uses, and decision buttons (Send Feedback, Approve) on the top right.

1. **Main annotator interface** — full Plannotator Viewer with block rendering (headings, lists, code, tables, HTML,
   diagrams), annotation selections, annotation toolbar on selection, checkbox support
2. **View/edit toggle** — switch between Viewer (read-only plan display) and MarkdownEditor (editable markdown)
3. **Left sidebar** — Contents/Outline (Table of Contents) tab only; NO Files tab, NO Archive tab
4. **Right annotations sidebar** — AnnotationPanel with toggle button, same position as Plannotator; shows annotations
   on the plan, supports adding/viewing/resolving
5. **Decision toolbar (top right)** — Send Feedback button and Approve button in the same location as Plannotator;
   ApproveDropdown with agent switch
6. **Options menu** — theme toggle, print/save as PDF, Settings (with tabs: Display, Labels, Shortcuts, General); hide
   Integrations (no Obsidian/Bear/Octarine)
7. **Completion overlay** — shown after decision (approve/feedback/exit)
8. **Exit/cancel** — Exit button that closes review and returns to workflow

### Code Review Surface — required features (in priority order)

Approaching full Plannotator code review UI parity. Layout must match: diff viewer in dock panels, file tree sidebar,
inline annotations, decision toolbar.

1. **DiffViewer** — syntax-highlighted diff panels in dock layout (Plannotator's dockview layout)
2. **FileTree sidebar** — file list with status icons and navigation
3. **Inline line annotations** — click a diff line → add annotation comment inline
4. **ReviewSidebar** — annotation list panel with navigation to each annotation
5. **Decision toolbar** — Approve, Send Feedback, Exit buttons; ReviewSubmissionDialog on decision
6. **CompletionOverlay** — post-decision overlay
7. **Sections panel** — commit group organization (committed → staged → unstaged)

### Features explicitly OUT of scope (handled later or never):

- Plan Review: AI Chat panel, agent talk/terminal, integrations (Obsidian/Bear/Octarine), Files/Archive sidebar tabs,
  Goal Setup, Linked Docs, CodeFilePopout, Export/Import modals
- Code Review: Guide button/tour, agent chat/Ask AI, PR support, AgentReviewActions, worktree support, semantic diff

### Non-feature objectives:

1. **Decision parity:** `/api/decision`, `/api/deny`, `/api/feedback`, `/api/exit` endpoints resolve `waitForDecision()`
   identically to the compiled server.
2. **Workflow parity:** `review-launcher.js` returns `{ url, waitForDecision, stop, opened }` unchanged.
   `submit-plan.js` and `code-review.js` callers change nothing.
3. **Dev iteration:** `deno task workspace:dev:plan-review` and `deno task workspace:dev:code-review` open
   fixture-backed HMR routes for browser-driven component work.
4. **Theme propagation:** Selected RunWield theme reaches review surfaces — Plannotator ThemeProvider reads `--rw-*` CSS
   vars for correct colors.

## Approach

**Architecture:** A `startReviewServerForWorkflow(options)` function in `review-launcher.js` starts the existing
Workspace server wrapper (from `server.js`) on a dynamic port with a token, hands it a review payload, and returns
`{ url, waitForDecision, stop }`. Decision transport uses in-memory Promises resolved by local API endpoints mounted on
the same server.

**Plan Review surface strategy:** Build `PlanReviewSurface.tsx` as a React island that closely mirrors Plannotator's
editor interface. The layout uses Plannotator's `ThemeProvider` + `TooltipProvider` wrappers. The main pane renders
`Viewer` (with full block rendering, annotation selections, annotation toolbar) or `MarkdownEditor`. Left sidebar shows
only the Contents/Outline tab (`TableOfContents`). Right panel shows `AnnotationPanel`. Decision toolbar on top right
uses `ApproveDropdown`, `FeedbackButton`, and `ExitButton` from Plannotator's `ToolbarButtons`. Options gear icon opens
Plannotator's `Settings` (Display/Labels/Shortcuts/General tabs only, no Integrations). `usePrintMode` hook enables
print/save-as-PDF.

**Code Review surface strategy:** Build `CodeReviewSurface.tsx` as a React island that closely mirrors Plannotator's
review-editor interface. Layout uses `DockviewReact` from `dockview-react` for the panel system. Diff panels use
`DiffViewer` with syntax highlighting. `FileTree` sidebar for file navigation. `InlineAnnotation` for click-to-annotate
on diff lines. `ReviewSidebar` for annotation list. `SectionsPanel` for commit grouping. Decision toolbar with
`ApproveButton`, `FeedbackButton`, `ExitButton` + `ReviewSubmissionDialog` for confirmation. No guide, no AI chat.

**Flow (workflow mode):**

1. Workflow calls `startPlanReviewSurface({ plan })` or `startCodeReviewSurface({ rawPatch, ... })`
2. `review-launcher.js` starts a local Workspace server with review-specific API routes + serves the Astro review page
3. Workspace astro page renders the React island, embedding payload as JSON in a `<script>` tag
4. React island renders the Plannotator-based UI at the correct layout, user clicks approve/feedback/exit
5. React island `POST`s to `/api/review/decision`, `/api/review/deny`, `/api/review/feedback`, or `/api/review/exit`
6. API handler resolves the in-memory Promise in the server process
7. `waitForDecision()` resolves, workflow continues, server stops

## Files to Modify / Create

### New files

- **`src/ui/workspace/react/PlanReviewSurface.tsx`** — React island for Plan review with Viewer/MarkdownEditor, left
  sidebar (Contents only), right AnnotationPanel, top-right decision toolbar, options gear with Settings/Print.
- **`src/ui/workspace/react/CodeReviewSurface.tsx`** — React island for Code review with DockviewReact diff panels,
  FileTree sidebar, inline annotations, ReviewSidebar, sections panel, decision toolbar.
- **`src/ui/workspace/routes/api/review-handlers.js`** — Review decision API handlers with in-memory Promise Map keyed
  by token: `reviewDecisionApi`, `reviewDenyApi`, `reviewFeedbackApi`, `reviewExitApi`.
- **`src/ui/workspace/react/review-types.ts`** — Shared JSDoc typedefs for review payloads, decisions, and surfaces.

### Modified files

- **`src/ui/workspace/pages/review/plan.astro`** — Astro page that renders PlanReviewSurface as a React island. Reads
  review payload from `Astro.request` headers or embedded state. Guards behind token check.
- **`src/ui/workspace/pages/review/code.astro`** — Astro page that renders CodeReviewSurface as a React island. Reads
  review payload from request state. Guards behind token check.
- **`src/ui/workspace/pages/dev/plan-review.astro`** — Replace inline review-dev-surface import with PlanReviewSurface
  using fixture data. Keep DEV guard so it's only available in dev mode.
- **`src/ui/workspace/pages/dev/code-review.astro`** — Same: replace with CodeReviewSurface using fixture patch data.
- **`src/ui/workspace/server.js`** — Add review-mode setup: `createReviewWorkspaceApp(options)` that registers review
  API routes alongside existing workspace routes. Expose `startReviewWorkspaceServer(options)` that returns
  `{ url,
  waitForDecision, stop }`. The core decision Promise lives in module scope keyed by token.
- **`src/shared/workflow/review-launcher.js`** — Add `startReviewServerForWorkflow(options)` that:
  1. Generates a token
  2. Calls `startReviewWorkspaceServer` from server.js with the token + review payload
  3. Opens the browser to `{url}/review/plan?token={token}` or `/review/code?token={token}`
  4. Returns `{ url, waitForDecision, stop, opened }` Update `startPlanReviewSurface` and `startCodeReviewSurface` to
     use this when the Workspace-hosted path is active (controlled by a feature flag or direct function injection).
- **`src/ui/workspace/react/ReviewDevSurface.tsx`** — Update to reuse PlanReviewSurface and CodeReviewSurface with
  fixture data instead of its own inline fixture rendering.
- **`deno.json`** — Already has `workspace:dev:plan-review` and `workspace:dev:code-review` tasks on the workspace
  branch; verify they still work with the new page content.

## Plannotator Component Reuse Map

### Plan Review Surface — imports from `@plannotator/ui/components/`:

| Feature                           | Plannotator Component             | Location                                         |
| --------------------------------- | --------------------------------- | ------------------------------------------------ |
| Plan body rendering               | `Viewer`                          | `@plannotator/ui/components/Viewer`              |
| Markdown edit mode                | `MarkdownEditor`                  | `@plannotator/ui/components/MarkdownEditor`      |
| Annotation panel (right sidebar)  | `AnnotationPanel`                 | `@plannotator/ui/components/AnnotationPanel`     |
| Annotation toolbar (on selection) | `AnnotationToolstrip`             | `@plannotator/ui/components/AnnotationToolstrip` |
| Approve button                    | `ApproveButton`                   | `@plannotator/ui/components/ToolbarButtons`      |
| Send feedback button              | `FeedbackButton`                  | `@plannotator/ui/components/ToolbarButtons`      |
| Exit button                       | `ExitButton`                      | `@plannotator/ui/components/ToolbarButtons`      |
| Approve dropdown (agent switch)   | `ApproveDropdown`                 | `@plannotator/ui/components/ApproveDropdown`     |
| Theme wrapper                     | `ThemeProvider`                   | `@plannotator/ui/components/ThemeProvider`       |
| Tooltip wrapper                   | `TooltipProvider`                 | `@plannotator/ui/components/Tooltip`             |
| Table of Contents sidebar         | `TableOfContents`                 | `@plannotator/ui/components/TableOfContents`     |
| Sidebar tabs/container            | `SidebarTabs`, `SidebarContainer` | `@plannotator/ui/components/sidebar/`            |
| Completion overlay                | `CompletionOverlay`               | `@plannotator/ui/components/CompletionOverlay`   |
| Confirm dialog                    | `ConfirmDialog`                   | `@plannotator/ui/components/ConfirmDialog`       |
| Settings                          | `Settings`                        | `@plannotator/ui/components/settings/Settings`   |
| Resize handle                     | `ResizeHandle`                    | `@plannotator/ui/components/ResizeHandle`        |
| Scroll area                       | `OverlayScrollArea`               | `@plannotator/ui/components/OverlayScrollArea`   |
| Print mode                        | `usePrintMode`                    | `@plannotator/ui/hooks/usePrintMode`             |

### Code Review Surface — imports:

| Feature                   | Plannotator Component                            | Location                                          |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Diff viewer (dock layout) | `DockviewReact` from `dockview-react`            | review-editor app dependency                      |
| Diff panel rendering      | `DiffViewer`                                     | review-editor `components/DiffViewer`             |
| File tree sidebar         | `FileTree`                                       | review-editor `components/FileTree`               |
| File header per side      | `FileHeader`                                     | review-editor `components/FileHeader`             |
| Inline line annotations   | `InlineAnnotation`                               | review-editor `components/InlineAnnotation`       |
| Annotation list sidebar   | `ReviewSidebar`                                  | review-editor `components/ReviewSidebar`          |
| Approve button            | `ApproveButton`                                  | `@plannotator/ui/components/ToolbarButtons`       |
| Feedback button           | `FeedbackButton`                                 | `@plannotator/ui/components/ToolbarButtons`       |
| Exit button               | `ExitButton`                                     | `@plannotator/ui/components/ToolbarButtons`       |
| Review submission dialog  | `ReviewSubmissionDialog`                         | review-editor `components/ReviewSubmissionDialog` |
| Completion overlay        | `CompletionOverlay`                              | `@plannotator/ui/components/CompletionOverlay`    |
| Sections panel            | `SectionsPanel`                                  | review-editor `components/SectionsPanel`          |
| Theme wrapper             | `ThemeProvider`                                  | `@plannotator/ui/components/ThemeProvider`        |
| Annotations/hooks         | `useEditorAnnotations`, `useExternalAnnotations` | `@plannotator/ui/hooks/`                          |

## Implementation Steps

### Step 1: Define review types and decision transport

- [ ] Create `src/ui/workspace/react/review-types.ts` with JSDoc typedefs:
  - `PlanReviewOptions` —
    `{ plan: string, token: string, mode: "workflow" | "dev", frontmatter?: object, imageBaseDir?: string }`
  - `CodeReviewOptions` —
    `{ rawPatch: string, gitRef: string, agentCwd: string, token: string, mode: "workflow" | "dev" }`
  - `PlanReviewDecision` —
    `{ approved: boolean, feedback?: string, savedPath?: string, exit?: boolean, agentSwitch?: string, permissionMode?: string }`
  - `CodeReviewDecision` —
    `{ approved: boolean, feedback: string, annotations: CodeReviewAnnotation[], exit?: boolean, canceled?: boolean, agentSwitch?: string }`
  - `ReviewSurfaceResult` — `{ url: string, waitForDecision: () => Promise<any>, stop: () => void | Promise<void> }`

### Step 2: Create review API handlers

- [ ] Create `src/ui/workspace/routes/api/review-handlers.js`:
  - Module-level `Map<string, { resolve: (value: any) => void }>` keyed by token
  - `registerReviewDecisionPromise(token)` — creates a new entry, returns `{ resolve, promise }`
  - `resolveReviewDecision(token, decision)` — resolves the promise for that token
  - `unregisterReviewDecision(token)` — cleanup, with server-side timeout (30 min) to prevent hangs
  - Export handler functions: `reviewDecisionApi(ctx)`, `reviewDenyApi(ctx)`, `reviewFeedbackApi(ctx)`,
    `reviewExitApi(ctx)`
  - Each reads token from header/query, validates, resolves, and returns JSON `{ ok: true }`
  - Include error handling: return 401 for invalid token, 404 for expired/completed review

### Step 3: Implement PlanReviewSurface React component

- [ ] Create `src/ui/workspace/react/PlanReviewSurface.tsx`:
  - Reads payload from `script[data-review-payload]` JSON embed
  - Wraps in `ThemeProvider` + `TooltipProvider` (Plannotator component wrappers)
  - **Layout** (matching Plannotator's plan review interface):
    - Full-height flex column: header toolbar (top) → main content area (flex-1)
    - Header: left is app title/metadata; right is feedback/approve/exit buttons
    - Main area: 3-column — left sidebar (Contents/Outline) | center (Viewer or MarkdownEditor) | right
      (AnnotationPanel)
  - **Left sidebar** with `SidebarTabs` / `SidebarContainer` — only Contents/Outline (`TableOfContents`) tab; NO Files,
    NO Archive
  - **Center pane** renders `Viewer` (read mode) or `MarkdownEditor` (edit mode) with toggle
    - Viewer: full Plannotator Viewer with blocks, annotation selections, annotation toolbar, checkbox support
    - MarkdownEditor: for editing plan body, wrapped via existing PlannotatorPlanBody pattern
  - **Right panel**: `AnnotationPanel` with toggle button (same position as Plannotator)
  - **Decision toolbar** (top right): `ApproveDropdown`, `FeedbackButton`, `ExitButton` in Plannotator's layout
  - **Options menu** (gear icon): theme toggle, print/save as PDF, Settings (Display/Labels/Shortcuts/General tabs)
    - `usePrintMode` hook from Plannotator
    - Settings from `@plannotator/ui/components/settings/Settings`
  - Decision flows:
    - Approve: POST `/api/review/decision` with `{ approved: true, feedback?, agentSwitch? }`
    - Send Feedback: POST `/api/review/deny` with `{ feedback }`
    - Exit: POST `/api/review/exit`
  - On POST success: show `CompletionOverlay` from Plannotator
  - On POST error: show error state
  - Dev mode (`mode: "dev"`): log decisions to console instead of POSTing
  - Use `ResizeHandle`, `OverlayScrollArea` for layout polish

### Step 4: Implement CodeReviewSurface React component

- [ ] Create `src/ui/workspace/react/CodeReviewSurface.tsx`:
  - Reads payload from `script[data-code-review-payload]` JSON embed
  - Wraps in `ThemeProvider` + `TooltipProvider`
  - **Layout** (matching Plannotator's code review interface):
    - Full-height flex column: header → dock container with panels
    - Header: file tree toggle, diff metadata, approve/feedback/exit on right
    - Main area: dockview-based layout with file diff panels
  - Parse raw patch into `DiffFile[]` array (use `parseDiffToFiles` from review-editor)
  - Render `DockviewReact` with `dockview-react` for the panel layout
  - **FileTree** sidebar: toggleable, shows file list with status icons
  - **Diff panels**: each file gets a `DiffViewer` panel in the dock with syntax-highlighted diff
  - **File headers**: `FileHeader` component per file with status info
  - **Inline annotations**: `InlineAnnotation` on diff lines — click to add annotation
  - **ReviewSidebar**: annotation list panel with navigation
  - **SectionsPanel**: commit group organization (committed → staged → unstaged)
  - Decision toolbar: `ApproveButton`, `FeedbackButton`, `ExitButton`
  - `ReviewSubmissionDialog` on decision click
  - `CompletionOverlay` post-decision
  - Decision flows:
    - Approve: POST `/api/review/feedback` with `{ approved: true, feedback, annotations }`
    - Feedback: POST `/api/review/feedback` with `{ approved: false, feedback, annotations }`
    - Exit: POST `/api/review/exit`
  - Dev mode: log decisions instead of POSTing
  - Use `normalizeCodeReviewDecision` from `code-review.js` for consistency
  - Handle empty/error diff states

### Step 5: Create Astro review pages

- [ ] Create `src/ui/workspace/pages/review/plan.astro`:
  - Receives review payload from server-side state (x-runwield-review-payload header or global)
  - Embeds payload as `JSON.stringify` in a `<script type="application/json" data-review-payload>`
  - Renders `<PlanReviewSurface client:only="react" />`
  - Guards behind token check via server wrapper
- [ ] Create `src/ui/workspace/pages/review/code.astro`:
  - Same pattern but with `<CodeReviewSurface>` and code review payload
- [ ] Update `src/ui/workspace/pages/dev/plan-review.astro`:
  - Replace inline ReviewDevSurface with `<PlanReviewSurface>` using fixture plan data
  - DEV guard remains
- [ ] Update `src/ui/workspace/pages/dev/code-review.astro`:
  - Same pattern with fixture patch data

### Step 6: Wire Workspace server for review mode

- [ ] In `src/ui/workspace/server.js`:
  - Import review handlers from `./routes/api/review-handlers.js`
  - Add `createReviewWorkspaceApp(options)` function:
    - Accepts `{ cwd, token, reviewPayload, reviewType: "plan" | "code" }`
    - Returns `{ handler: () => (request) => Promise<Response> }`
    - Registers review API routes: `POST /api/review/decision`, `/api/review/deny`, `/api/review/feedback`,
      `/api/review/exit`
    - Registers static/theme routes (same as workspace)
    - Registers Astro page route: `/review/plan` or `/review/code`
    - Passes review payload via request header `x-runwield-review-payload` injected in the handler
    - Token check applies to review routes
  - Add `startReviewWorkspaceServer(options)` function:
    - Accepts `{ cwd, token, reviewPayload, reviewType, signal }`
    - Starts a `Deno.serve` on a dynamic port
    - Returns `{ url, waitForDecision, stop }`
    - `waitForDecision` delegates to `review-handlers.js` in-memory promise
    - `stop` closes the server and cleans up the decision promise

### Step 7: Update review-launcher.js

- [ ] In `src/shared/workflow/review-launcher.js`:
  - Import `startReviewWorkspaceServer` from workspace server.js
  - Add internal helper `startWorkspaceHostedPlanReview({ plan, token })`:
    - Calls `startReviewWorkspaceServer({ cwd: Deno.cwd(), token, reviewPayload: { plan }, reviewType: "plan" })`
    - Opens browser to `{url}/review/plan?token={token}`
    - Returns `{ url, waitForDecision, stop, opened }` (registered via `registerReviewSurface`)
  - Add internal helper `startWorkspaceHostedCodeReview({ rawPatch, gitRef, agentCwd, token })`:
    - Same pattern with `reviewType: "code"` and code review payload
  - Update `startPlanReviewSurface`:
    - Default to Workspace-hosted path
    - Keep compiled server as injectable fallback (`opts.startPlanReviewServer`)
  - Update `startCodeReviewSurface`:
    - Default to Workspace-hosted path
    - Keep compiled server as injectable fallback
  - Keep `loadPlanReviewHtml`, `loadReviewEditorHtml`, `openInDefaultBrowser` exports for compatibility

### Step 8: Update ReviewDevSurface to use real components

- [ ] In `src/ui/workspace/react/ReviewDevSurface.tsx`:
  - Replace inline fixture rendering with imports of `PlanReviewSurface` and `CodeReviewSurface`
  - Pass fixture data as their payloads
  - Set `mode: "dev"` so components log decisions instead of POSTing
  - Keep the page header and contextual metadata display

### Step 9: Verify theme propagation

- [ ] Confirm `loadRunWieldThemeCss()` is served at `/theme.css` route
- [ ] Confirm review pages load `/theme.css` in `<head>`
- [ ] Confirm Plannotator `ThemeProvider` reads CSS variables correctly
- [ ] Run visual check: approve button green, text contrast correct, annotation colors visible

### Step 10: Dev task verification

- [ ] Run `deno task workspace:dev:plan-review` — verify fixture-backed plan review opens with HMR
- [ ] Run `deno task workspace:dev:code-review` — verify fixture-backed code review opens with HMR
- [ ] Confirm all Plannotator components render, theme applies, resize/scroll works

## Verification Plan

- **Automated:** `deno task -q workspace:check` — no type/build errors in review components
- **Automated:** `deno task -q workspace:test` — existing workspace tests pass
- **Automated:** `deno task -q test` — workflow tests covering `review-launcher.js` adapter behavior pass
- **Automated:** `deno task -q check` — project-wide type check passes
- **Manual/frontend (dev mode):** Run `deno task workspace:dev:plan-review`, verify:
  - Plan content renders via Plannotator Viewer/RenderedMarkdown (blocks, headings, lists, code, tables)
  - Approve/feedback/exit buttons visible and ThemeProvider renders
  - Buttons log to console (dev mode) without hitting API
  - HMR works on component edits
  - Theme CSS variables apply (check dev tools → computed styles)
- **Manual/frontend (dev mode):** Run `deno task workspace:dev:code-review`, verify:
  - Diff renders via Plannotator DiffViewer with syntax highlighting
  - File tree visible and navigable
  - Inline annotation controls appear on line hover
  - Approve/feedback/exit buttons visible
  - HMR works, theme applies
- **Manual/frontend (workflow mode):** Test a real plan review workflow:
  - Trigger `submitPlanForReview` (e.g. through `wld plans ui` or a test script that calls the launcher)
  - Verify browser opens to `localhost:<port>/review/plan?token=<token>`
  - Verify plan content visible, approve/feedback/exit all functional
  - Approve → verify `waitForDecision()` resolves with `{ approved: true }` and server stops
  - Send feedback → verify resolves with `{ approved: false, feedback: "..." }`
  - Exit → verify resolves with exit-like decision
- **Manual/frontend (workflow mode):** Test a real code review workflow:
  - Trigger `runPlannotatorCodeReview` with a real diff
  - Verify browser opens to code review page with diff rendered
  - Verify approve, feedback with annotations, and exit all return correct decisions
- **Expected result:** All workflow callers (`submit-plan.js`, `code-review.js`) return the same result shapes they
  would from the compiled server. The compiled `@gandazgul/plannotator-pi-extension-compiled/server` import is no longer
  used in default operation.

## Edge Cases & Considerations

- **Decision reliability:** If the browser window closes before a decision, `waitForDecision()` must not hang forever.
  Add a server-side timeout (e.g. 30 minutes) that resolves as expired/canceled.
- **Multiple review surfaces:** The per-token Promise map in review-handlers.js supports concurrent reviews. Each call
  to `startPlanReviewSurface` / `startCodeReviewSurface` gets its own token and Promise.
- **Window close detection:** Optional: add a `beforeunload` handler or `navigator.sendBeacon('/api/review/exit')` so
  closing the browser window doesn't leave the workflow hanging forever. Acceptable to let the timeout handle it for
  MVP.
- **Stale/expired reviews:** If a user opens an old review URL (token expired or resolved), the API returns 404/410 with
  an appropriate message.
- **Fixture dev pages vs. workflow pages:** Dev pages use `mode: "dev"` in their payload, causing components to log
  decisions instead of POSTing. Workflow pages wire real API calls. Both use the same React components.
- **Plannotator import compatibility:** The pinned Plannotator source under `third_party/plannotator/packages/ui/` uses
  TSX and React patterns. The workspace build config on the target branch already resolves `@plannotator/ui/` to this
  path and handles TSX/React compilation via Astro/Vite.
- **Plannotator hooks and state:** Components like `Viewer`, `AnnotationPanel`, and `MarkdownEditor` rely on Plannotator
  hooks (`useSharing`, `useAgents`, `useActiveSection`, `useSidebar`, `useAnnotationDraft`, etc.). These hooks need the
  correct provider context. Use `ThemeProvider` and `TooltipProvider` wrappers. Skip hooks requiring
  Plannotator-specific backends (sharing, AI). Reuse `useEditorAnnotations` and `useSidebar` hooks as they are
  state-only.
- **Code review dockview-react:** The review-editor uses `dockview-react` for panel layout. Ensure this dependency is
  available in the workspace. The Plannotator package.json lists `dockview-react` as a dependency.
- **Code review annotation persistence:** Annotations are stored in React state and submitted with the decision payload.
  The compiled server saves drafts; our MVP can skip draft persistence and only submit on decision.
- **Plan review view/edit toggle:** Plannotator's editor App manages `editorMode` through state and `saveEditorMode`
  utility. Reuse `getEditorMode` / `saveEditorMode` from `@plannotator/ui/utils/editorMode`.
- **Compiled server fallback:** Keep the compiled `@gandazgul/plannotator-pi-extension-compiled/server` import path
  available as a dependency injection override (`opts.startPlanReviewServer`) until Workspace-hosted surfaces are
  verified in workflow mode.
