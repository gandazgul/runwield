---
name: front-end-framework-use
description: Convention-first frontend engineering for RunWield agents. Use this skill when implementing, fixing, debugging, or reviewing frontend UI/UX work in JavaScript, HTML, or CSS across frameworks such as React, Vue, Svelte, Next.js, Vite, Astro, or TanStack; especially when source-first code exploration, current framework docs, and real-browser verification should guide the change. Don't use for TUI work.
---

# Front-End Framework Use

Convention-first frontend editing: discover what the project already does, continue that pattern, verify the result. The
default instinct is to invent; this skill redirects to _match_ — match the styling system, the component structure, the
data layer, the test style — and invent only when no convention exists to follow.

## Shared browser context

When browser verification is needed, use the bundled `agent-browser-use` skill. It drives `agent-browser` with the
`--headed` flag so the browser window is a shared workspace — you and the user see the same page, the same state, and
the same navigation in real time. This lets the user talk about what they see and lets you respond to the same visual
context. Use `agent-browser-use` as the browser workflow; do not switch to ad hoc Playwright, Puppeteer, or other
browser tooling for app inspection unless the user explicitly asks for it.

## Feedback Loop

When reviewing rather than implementing, the same loop applies: discover the stack, read the source, then audit the
change against the reference sections below. Step 5 becomes _verify_ convention-first rather than _implement_. If plan
metadata marks `frontend: true`, the browser portions of this loop are mandatory unless blocked.

1. Discover the stack before editing.
   - Project context or core memories often name the framework stack already. If not, identify the framework, version,
     package manager, JS runtime, dev-server command, and relevant routes/components from config files.
   - Discover framework-specific conventions the project follows — for example, Next.js `app/` vs `pages/` routing, Nuxt
     `composables/` auto-imports, SvelteKit `+page.svelte` naming, or Astro island directives. When a convention is
     uncertain, search current docs with the `ketch` skill.
   - Completion: you can name the files, commands, and framework conventions that govern the UI behavior you are
     changing.

2. Read the source before using the browser.
   - Prefer `code_*` tools for components, hooks, utilities, route definitions, and call sites.
   - Use file search for templates, styles, config, generated route manifests, and package metadata.
   - Completion: the current behavior is explained by source, config, or a reproducible browser observation.

3. Check current docs when framework behavior is uncertain.
   - Use the `ketch` skill for current framework, library, or browser API documentation.
   - Completion: the implementation choice is backed by project source or current external docs, not memory alone.

4. Use the browser only for visual, interactive, or browser-specific questions.
   - Use the `agent-browser-use` skill; start headed sessions so the user can see navigation and page changes.
   - Prefer screenshots over eval scripts for layout, spacing, responsive behavior, and visual styling.
   - Completion: the browser observation answers a question the source alone could not.

5. Implement convention-first.
   - Match the project's component structure, styling system, state management, data-loading pattern, accessibility
     conventions, and test style. Consult the reference sections below for domain-specific convention checks.
   - Use the project's normal dev or preview command when browser verification needs a running app. Prefer hot reload;
     restart only when config, environment, dependency, or stale-server state requires it.
   - Completion: the change is localized and consistent with neighboring code; no new pattern introduced where an
     existing convention covers the case.

6. Verify before finishing.
   - Run the project's CI, lint, tests, type checks, or formatter as appropriate.
   - Use `agent-browser-use` when behavior is visual, interactive, responsive, accessibility-sensitive, or
     browser-specific.
   - Capture evidence at the viewport and state that matter: desktop/mobile screenshots for layout changes,
     accessibility snapshot for changed controls, console errors, failed network requests, final URL/title, and the
     relevant success/failure state.
   - Completion: command output and browser evidence cover the user-visible change; no relevant console or network
     failure remains unexplained.

7. Confirm the original request is actually solved.
   - Re-read the user's request before reporting. Check that the implemented behavior, visual result, and edge cases
     match what the user asked for, not just that the code is clean or tests pass.
   - Use source inspection, commands, and `agent-browser-use` evidence as appropriate; for visual requests, the final
     screen state should visibly prove the requested change.
   - Completion: you can point to the code, command output, or browser evidence that shows the initial request is
     satisfied.

## Convention-First Reference

Consult these sections during step 5 (implement) and step 6 (verify). Each covers a domain where convention-first
editing requires domain-specific checks.

### Component Architecture

Convention-first composition: discover how the project structures and combines components before adding new ones.

- Identify the project's composition model — presentational vs container, compound components, render props, slots,
  hooks, or higher-order components. Follow whichever pattern neighboring components use.
- Place new components where the project's file and folder conventions expect them — check for barrel files, index
  re-exports, co-located styles and tests, and naming conventions.
- Respect server vs client component boundaries when the framework supports them (React Server Components, Astro
  islands, Nuxt server components). Do not move code across that boundary without understanding the serialization and
  hydration implications.
- Identify the runtime boundary for changed code — server, browser, edge, build-time, route loader/action, or hydrated
  island/component. Keep browser-only APIs, secrets, request context, and side effects on the correct side of that
  boundary.
- Preserve hydration assumptions: server-rendered markup, initial client state, generated IDs, dates, random values, and
  feature flags must not diverge between server render and client startup.
- Identify the rendering model for affected pages — static generation (SSG), server-side rendering (SSR), incremental
  regeneration (ISR), or client-only SPA. Data fetching, caching, and component boundaries differ by model; match the
  existing pattern for pages of the same type.
- When data or state needs to flow between components, use the project's existing mechanism (props, context, store,
  signals) before introducing a new one.
- Identify the project's error handling pattern — error boundaries, error pages, toast notifications, or fallback UI.
  New components that can fail (async data, user input, third-party integrations) should use the same recovery
  mechanism.
- When the project is mid-migration between two patterns (e.g., class → hooks, Options → Composition API, Pages → App
  Router), follow the newer pattern unless the file you're editing is entirely in the older one. Do not partially
  migrate a file as a side effect of an unrelated change — migration scope is a user decision.
- Completion: new components follow the same structural patterns, file placement, and composition style as their
  neighbors.

### Routing and Navigation

Convention-first navigation: discover how the project handles routes before changing them.

- Identify the routing model — file-based vs config-based, nested vs flat, app directory vs pages directory.
- Preserve route guards, middleware, auth protection, and permission checks on affected routes.
- Follow the project's pattern for client-side navigation vs full page loads; do not mix unless the project already
  does.
- Maintain prefetching, preloading, and scroll restoration behavior on changed routes.
- Completion: affected routes still load, guard, and navigate as they did before the change; no route left unprotected
  that was protected before.

### State Management

Convention-first state: discover the state layer before introducing state.

- Identify the state manager the project uses — Redux, Zustand, Pinia, Svelte stores, signals, React context, or
  framework built-ins.
- Respect boundaries between local component state, shared application state, and server/cache state (TanStack Query,
  SWR, Apollo). Use each at the same scope as existing code.
- Follow the project's patterns for optimistic updates, cache invalidation, and derived state.
- Do not introduce a competing state mechanism when the project already has one that covers the use case.
- Completion: new state lives in the same layer, uses the same patterns, and follows the same update conventions as
  equivalent existing state.

### Design System Discovery

Treat every frontend project as having a design system, even when it is informal.

- Identify the component library, reusable primitives, design tokens, icon set, spacing/radius/shadow scales,
  typography, breakpoints, motion patterns, and color modes before designing new UI.
- Compare the nearest existing screen or component before introducing new visual language.
- Prefer composing existing primitives over styling raw elements.
- Completion: you can name the reusable primitives and visual rules you are following, or state that none exist and
  introduce the smallest local pattern.

### Styling and CSS Systems

Treat styling as part of the app's design system, even when the system is informal.

1. Discover the styling model before adding CSS.
   - Identify whether the project uses CSS modules, global CSS, utility classes, CSS-in-JS, Tailwind, design tokens,
     component libraries, or plain stylesheets.
   - Completion: you know where reusable styles, tokens, theme variables, and component-level styles live.

2. Prefer existing primitives over new one-off styles.
   - Reuse existing components, layout wrappers, spacing scales, color tokens, typography classes, and interaction
     states.
   - Do not introduce a new color, spacing value, breakpoint, z-index, shadow, or font size until existing options are
     ruled out.
   - Completion: every new visual value is either reused from the system or intentionally introduced with justification.

3. Keep CSS organized by responsibility.
   - Put reusable decisions in tokens, variables, utilities, or shared components.
   - Put component-specific layout and states near the component.
   - Avoid leaking page-specific selectors into global CSS.
   - Completion: a future nearby component can reuse the shared part without copying the whole style block.

4. Make responsive and state styling explicit.
   - Check hover, focus, active, disabled, selected, loading, empty, error, long-content, narrow-width, and dark/light
     modes when relevant.
   - Prefer fluid layout primitives (flex, grid, clamp, min/max) over fixed pixel positioning.
   - Completion: the style works across the relevant viewport and UI states.

5. Keep selectors boring.
   - Prefer low-specificity selectors, class names with clear ownership, and predictable cascade boundaries.
   - Avoid `!important`, deep descendant chains, and styling through incidental DOM structure unless the project already
     uses that pattern.
   - Completion: no new specificity level introduced beyond what neighboring styles use; the style can be overridden by
     the same mechanisms the rest of the codebase uses.

### Accessibility

Build on browser semantics before adding custom behavior.

- Use buttons for actions, links for navigation, labels for inputs, and headings/lists/landmarks where they match the
  content.
- Keep keyboard behavior intact: tab order, visible focus, Enter/Space activation, and Escape dismissal where relevant.
- Check screen-reader-facing names through the accessibility snapshot when adding or changing controls.
- Do not rely on color alone for state, errors, selection, or priority.
- Completion: the changed UI has a semantic shape, keyboard path, and accessible names that match the visible
  experience.

### Responsive Behavior

Design for content and containers, not one viewport.

- Check realistic desktop and mobile widths when layout changes.
- Account for long text, wrapping, overflow, sticky regions, modals, and scroll containers.
- Completion: the layout does not clip, overlap, or hide content at the project's supported viewport widths, tested with
  realistic-length strings.

### Content Resilience

Design for real content, not fixture-shaped content.

- Test long labels, translated text, user-generated names, empty values, dense lists/tables, and unbroken strings such
  as URLs or IDs.
- Make overflow intentional: choose wrapping, truncation, scrolling, or expansion deliberately, and preserve access to
  the full value when truncating.
- Check sticky headers/footers, nested scroll regions, modals, popovers, and sidebars with both short and long content.
- Completion: realistic content cannot overlap controls, escape containers, hide required actions, or become unreadable
  at supported widths.

### Visual Quality

Convention-first applies to aesthetics, not just code.

- Compare nearby screens and components for spacing, rhythm, density, typography, icon use, and interaction patterns.
- Include all relevant interaction and UI states when the component supports them.
- Capture before/after screenshots when the change is visual.
- Completion: the change looks intentional beside adjacent UI, not merely functional in isolation.

### Data and Async UX

Make network and state transitions visible and stable.

- Use intentional loading, empty, stale/revalidating, and success states instead of accidental blank space or silent
  transitions.
- Avoid layout shift when data loads; preserve the user's scroll position, selection, filters, and input context across
  refreshes and mutations.
- Surface failures near the action or content that caused them, with retry or recovery when the existing product pattern
  supports it.
- Guard duplicate submits or repeated actions while async work is pending.
- Prevent async races: ignore stale responses, cancel obsolete requests when the stack supports it, and keep optimistic
  UI consistent with rollback/error paths.
- Completion: the UI remains understandable while data is loading, updating, or failing.

### Forms

Treat forms as interaction design, not just inputs.

- Use native form semantics where possible: real `form`, `label`, `input`, `button`, `fieldset`, and `legend` elements
  before custom controls.
- Use explicit labels, helper text, validation messages, input modes, and autocomplete where appropriate.
- Validate at useful times: not so early that typing feels broken, and not only after submit when earlier feedback is
  cheap.
- Keep validation errors actionable, associated with their fields, announced accessibly, and preserve user input across
  failed submits.
- Make submission state explicit: disable or guard duplicate submits, keep the user's context visible, and show success
  or failure at the place the user acted.
- Completion: a user can understand what each field needs, recover from errors, and submit without losing work.

### Internationalization

Convention-first i18n: if the project translates user-facing strings, continue that practice.

- Identify the i18n library and message file format (JSON, YAML, ICU, gettext, etc.).
- Never hardcode user-facing strings in projects that use i18n — add new keys following the project's naming and file
  placement conventions.
- Respect RTL/LTR layout implications when the project supports bidirectional text.
- Completion: no new user-facing string bypasses the project's i18n pipeline; new keys follow existing naming
  conventions.

### Performance

Avoid frontend changes that make the UI feel slower or heavier.

- Keep work out of the client bundle unless the interaction needs browser state, browser APIs, or immediate client-side
  feedback.
- Avoid unnecessary rerenders, oversized client bundles, layout thrashing, expensive effects, and repeated serialization
  of large props/state.
- Lazy-load heavy UI only when it improves the user experience; do not hide above-the-fold or interaction-critical UI
  behind avoidable loading waterfalls.
- Use the app's existing data layer instead of fetching the same data repeatedly from multiple components.
- Check whether the change affects the page's LCP element, introduces layout shift (CLS), or adds long tasks that could
  degrade interaction responsiveness (INP).
- Use the project's image component or optimization pipeline when one exists (next/image, nuxt-img, Astro Image).
  Provide responsive formats (srcset, WebP/AVIF) and lazy loading for below-fold images. Include meaningful alt text
  following the project's convention for decorative vs informative images.
- Use the project's font loading strategy; do not add new font faces without matching the existing loading pattern
  (font-display, preload, subsetting).
- Completion: the change does not introduce avoidable rendering, loading, or bundle-cost regressions; no new image or
  font bypasses the project's optimization pipeline.

### Testing

Convention-first testing: run what exists, match what exists. Defer test design and coverage strategy to the testing
skill.

- Run the project's existing test suite after changes; watch for broken selectors, snapshot mismatches, and flaky tests
  your change may have exposed.
- When adding components, check whether the project has component test patterns (Testing Library, Storybook, snapshot
  tests) and follow them.
- Completion: existing tests pass; any new test code matches the project's established test style.

### Frontend Safety

Preserve browser-side security boundaries.

- Render user content safely. Avoid unsafe HTML injection unless the project already has a reviewed sanitizer path;
  trace markdown, rich text, preview, and CMS content through that path before changing it.
- Do not put secrets, private tokens, privileged feature flags, or server-only assumptions in client code or serialized
  props.
- Preserve server-side auth and permission checks; UI gating is not an authorization boundary.
- Treat user-controlled URLs, redirects, links, downloads, uploads, and object URLs as security-sensitive.
- Completion: the browser receives only data and capabilities it is allowed to expose, and user-controlled content
  cannot create script execution, privilege escalation, or unsafe navigation.

## Escalation

If verification stalls, stop guessing. Report the exact command or browser step that failed, the observed output, and
the smallest manual check the user can perform, such as a screenshot, console log, or reproduction step.
