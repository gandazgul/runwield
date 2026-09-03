Stop using jargon and speak coherently. State things simply and concisely, like one human talking to another.

## Local Type Style

JSDoc: prefer `@typedef` for object shapes over inline annotations or `@type` casts. Define the type once and reference
it. Type function parameters in the `@param` block, not with `@type` declarations in the function body.

TypeScript: do not use `any`, `unknown`, or `object`. Define a type with named properties, or let TypeScript infer the
type. Do not define complex inline types.

## Running Tests

Run the suite with `deno task test` or `deno run -A scripts/run-tests.js <deno test args>`. Never run `deno test`
directly. It puts every test file in one process and uses the real `HOME`, which can rewrite your own `~/.wld` and
Mnemoteca database. `scripts/run-tests.js` gives each file its own process and a sandboxed `HOME` and
`MNEMOTECA_DB_PATH`.

Two rules keep tests safe:

- Resolve home and cwd through `getHomeDir()` and `getCwd()` in `src/constants.js`. Never read `Deno.env.get("HOME")` or
  `Deno.cwd()` directly in `src/`, and never cache either in a module-level `const`.
- Wrap any test that mutates `HOME` or the working directory in `withProcessGlobalTestLock`
  (`src/testing/process-global-lock.js`).

## Test Seams and Dependency Injection

RunWield has a zero-seam baseline. `deno task seams:check` enforces it and runs in `deno task ci`.

An injection seam is a public claim that something is **not ours**. Treat it as an architectural decision, not a testing
convenience:

- Do not add a seam for RunWield-owned machinery such as Plan writes, lifecycle transitions, registry writes, or locks.
- Do not write a conditional seam such as `__deps ? fake : real`.
- Fake the environment instead. Use `defineGitFixture` (`src/shared/git-test-fixture.ts`) for a real Git repository and
  `makeValidationProjectRoot` for a real Plan project.
- Use seams only for genuine boundaries: subprocesses, network, agent turns, CI runs, clocks, or other slow and
  nondeterministic external capabilities.

If `seams:check` fails, fix the code. Do not adopt or re-baseline a new seam.

## Frontend UX Work

Use the current RunWield browser design system and Workspace surfaces as the blueprint so new UI does not drift from the
established look and feel.

- Start with `docs/design-system.md`, then verify details against current source.
- Treat `src/ui/design-system/` as the implementation baseline: `tokens.css`, `components.css`, `theme-bridge.js`, and
  `components/react/RunWieldPrimitives.jsx`.
- Use `--rw-*` semantic tokens and the theme bridge. Do not use hard-coded colors.
- Before adding a visual pattern, check whether an existing one covers it. If a new one is necessary, document it in
  `docs/design-system.md` and add it to the shared design-system layer in the same change.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
