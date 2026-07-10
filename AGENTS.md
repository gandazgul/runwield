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
