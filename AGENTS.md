Language Strictness: Write 100% pure JavaScript (.js). NEVER write .ts files. NEVER use TypeScript syntax (interfaces,
type aliases) in executable code. ALL typing must be done via JSDoc comments. Except in src/ui/workspace/ where
TypeScript syntax is allowed.

JSDoc Convention: Prefer @typedef for object shapes over inline parameter annotations or inline @type casts. Define
types once and reference them. This keeps call-sites clean and avoids style drift between agents.

Example — define a typedef at the top of the module or in a shared types file:

/**

- @typedef {Object} MergeOptions
- @property {string} projectRoot
- @property {string} branch
- @property {string} [worktreePath]
- @property {string[]} [allowedDirtyPaths] */

then use it on the function: /** @param {MergeOptions} opts */

Additionally, for function params always make function param blocks rather @type declarations in the function body.

## Frontend UX Work

For frontend UX work, use the current RunWield browser design system and Workspace surfaces as the blueprint so new UI
work does not drift from the established look, feel, and UX.

- Start with `docs/design-system.md` for the canonical UX guidance, then verify details against current source.
- Treat `src/ui/design-system/` as the shared implementation baseline: `tokens.css`, `components.css`,
  `theme-bridge.js`, and React primitives in `components/react/RunWieldPrimitives.jsx`.
- Use RunWield `--rw-*` semantic tokens and the theme bridge instead of hard-coded colors or a separate visual theme.
- Preserve the current Workspace aesthetic, follow the existing patterns.
- For Plannotator components bridge its Tailwind/Radix-style tokens back to RunWield `--rw-*` variables rather than
  adopting a separate Plannotator visual identity.
- Before adding a new visual pattern, check whether an existing Workspace/design-system pattern already covers it; if a
  reusable pattern is genuinely needed, document it in `docs/design-system.md` and add it to the shared design-system
  layer in the same change.
