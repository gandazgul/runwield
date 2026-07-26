# Engineering Reference

Use this reference for frontend implementation details. Keep the project convention-first: source, config, and adjacent
code outrank generic framework memory. When framework behavior depends on current docs, use the `ketch` skill before
coding.

## Stack and runtime boundaries

- Identify the framework, router, package manager, JS runtime, rendering model, and file conventions from project files
  before changing behavior.
- Respect server, browser, edge, build-time, route loader/action, and hydrated island/component boundaries. Keep browser
  APIs, secrets, request context, and side effects on their intended side.
- Preserve server-rendered markup and hydration assumptions: initial state, generated IDs, dates, random values, feature
  flags, and serialized props must not diverge between server render and client startup.
- Match the existing rendering model for similar pages: SSG, SSR, ISR, SPA, partial hydration, or islands.

## Components and composition

- Identify the project's composition model: presentational/container split, compound components, render props, slots,
  hooks, signals, higher-order components, or framework primitives.
- Place new components where naming, folder, barrel export, co-located style, and test conventions expect them.
- Reuse existing primitives and wrappers before styling raw elements or creating new component families.
- In migrations, follow the newer pattern for new code unless the edited file is wholly in the older pattern. Keep broad
  migration outside incidental feature work.
- Components that can fail should use the project's existing error boundary, fallback, toast, route error, or recovery
  pattern.

## Routing and navigation

- Identify whether routing is file-based, config-based, nested, flat, app-directory, pages-directory, or router-library
  driven.
- Preserve guards, middleware, auth checks, permission checks, prefetch/preload behavior, scroll restoration, and route
  state on affected paths.
- Match the project's client-navigation/full-page-load convention.

## State and data

- Use the existing state layer at the same scope as comparable code: local state, context, stores, signals, Redux,
  Zustand, Pinia, server/cache state, TanStack Query, SWR, Apollo, route loaders, or framework built-ins.
- Follow existing conventions for optimistic updates, rollback, cache invalidation, derived state, stale response
  handling, cancellation, and duplicate-submit guards.
- Keep server/cache state separate from local UI state unless the project already combines them deliberately.

## Styling and selectors

- Identify the styling model: CSS modules, global CSS, utility classes, CSS-in-JS, Tailwind, design tokens, component
  libraries, or plain stylesheets.
- Reuse existing color, spacing, radius, shadow, typography, breakpoint, z-index, icon, and motion values before adding
  new ones.
- Put reusable decisions in tokens, variables, utilities, or shared components; put component-specific layout and state
  styling near the component.
- Prefer low-specificity selectors, owned class names, and predictable cascade boundaries. Match existing selector
  discipline rather than introducing deeper chains, incidental DOM coupling, or higher specificity.
- Make hover, focus, active, disabled, selected, loading, empty, error, long-content, narrow-width, and color-mode
  styles explicit where the component supports them.

## Internationalization

- If the project localizes user-facing strings, identify the library, message format, key naming, and file placement.
- Add strings through the existing i18n pipeline and respect interpolation, pluralization, formatting, and RTL/LTR
  implications.
- In non-localized projects, keep new copy easy to extract later: no concatenated grammar fragments or hidden text in
  logic branches.

## Performance, assets, and fonts

- Keep work out of the client bundle unless the interaction needs browser state, browser APIs, or immediate client-side
  feedback.
- Avoid unnecessary rerenders, oversized bundles, layout thrashing, expensive effects, repeated serialization, and
  duplicate fetching from multiple components.
- Lazy-load heavy UI only when it improves the user experience; do not hide above-the-fold or interaction-critical UI
  behind avoidable waterfalls.
- Use the project's image and asset optimization pipeline for responsive images, formats, lazy loading, and alt text.
- Use the project's font loading strategy. Add fonts only when the brief requires them and the loading/subsetting
  pattern is clear.
- Consider whether the change affects LCP, CLS, INP, long tasks, or perceived responsiveness.

## Testing convention

- Match existing test style and selectors for component, integration, Storybook, snapshot, e2e, and visual tests.
- Add or update tests only when the task scope or project convention calls for it; defer broader coverage strategy to
  the testing skill.
- When browser-side behavior changes, use the browser skill for manual evidence rather than inventing a new browser-test
  framework.

## Browser-side safety

- Render user content through the project's safe markdown, rich-text, preview, CMS, or sanitizer path.
- Keep secrets, private tokens, privileged flags, server-only assumptions, and authorization decisions out of client
  code and serialized props.
- Preserve server-side auth and permission checks; UI gating is only a convenience layer.
- Treat user-controlled URLs, redirects, links, downloads, uploads, object URLs, and postMessage-like channels as
  security-sensitive.

## Engineering completion criterion

The branch is complete when every changed component, route, state path, style hook, user-facing string, asset, test
expectation, and browser-exposed data flow follows the nearest project convention or has a scoped project-native reason
for extending it; no browser command details, UX behavior rules, or visual-direction rules need to be consulted from
this file.
