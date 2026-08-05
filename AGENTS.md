FEATURE is a legacy alias for PLANNED_CHANGE

The main codebase is JS with JSDoc, but we are migrating to TypeScript. Write new files in TypeScript, and migrate
existing JS files when you touch them for other reasons.

JSDoc: prefer `@typedef` for object shapes over inline annotations or `@type` casts — define the type once and reference
it. Type function parameters in the param block, never with `@type` declarations in the function body. Same for TS, dont
define inline complex types.

TypeScript: Don't use `any`, `unknown` or `object` in typescrypt always define or make sure the type can be infered.
Object should have apropert type defining its properties not just Object.

## Running Tests

Run the suite with `deno task test` (or `deno run -A scripts/run-tests.js <deno test args>`). Never run `deno test`
directly: it puts every test file in one process, and against a real `HOME` that rewrites your own `~/.wld` and
mnemosyne database. `scripts/run-tests.js` gives each file its own process and a sandboxed `HOME` and
`MNEMOSYNE_DB_PATH` — its header explains the details.

Two rules keep it that way:

- Resolve home and cwd through `getHomeDir()` / `getCwd()` in `src/constants.js`. Never read `Deno.env.get("HOME")` or
  `Deno.cwd()` directly in `src/`, and never cache either in a module-level `const` — each test file's realm loads at an
  arbitrary moment, so a snapshot can outlive the value it captured. The `runwield/no-module-scope-process-state` lint
  rule enforces this.
- Wrap any test that mutates `HOME` or the working directory in `withProcessGlobalTestLock`
  (`src/testing/process-global-lock.js`).

## Test Seams and Dependency Injection

RunWield has eliminated the `__deps`/`__testDeps` dependency-bag pattern and forbids its return under a different name.
See `plans/replace-deps-bag-with-capability-ports.md` for the migration history and load the bundled `write-tests` skill
before changing tests. `deno task seams:check` enforces the zero-seam baseline and runs in `deno task ci`.

An injection seam is a public claim that something is **not ours**. Treat it as an architectural decision, not a testing
convenience:

- **Never add a seam for RunWield's own machinery.** Plan writes, lifecycle transitions, registry writes, and locks are
  the code under test even when they are not the subject of the test. A guarantee that only exists when components
  compose (atomicity, "all or nothing") cannot be tested with the composing part removed. The ratchet fails the build on
  any new one.
- **Never write a conditional seam.** `__deps ? fake : real` makes a module's behaviour depend on whether anything at
  all was injected, so injecting a clock can silently disable a transaction. This has caused real defects here and is
  rejected with no exceptions.
- **Do not add injection seams.** Fake the _environment_ instead: `defineGitFixture` (`src/shared/git-test-fixture.ts`)
  gives a real Git repository for ~5ms, and `makeValidationProjectRoot` gives a real Plan project. A real fixture is
  cheaper than authoring a fake.
- **Seams are for genuine boundaries only**: things that leave the process (subprocess, network), or are slow and
  nondeterministic (agent turns, CI runs, clocks). Everything else is ours.

The baseline is zero. If `seams:check` fails, fix the code; do not adopt or re-baseline the new seam. A required
capability port is acceptable only when it represents a declared external boundary and has no production fallback.

## Frontend UX Work

Use the current RunWield browser design system and Workspace surfaces as the blueprint so new UI does not drift from the
established look and feel.

- Start with `docs/design-system.md`, then verify details against current source.
- Treat `src/ui/design-system/` as the implementation baseline: `tokens.css`, `components.css`, `theme-bridge.js`, and
  `components/react/RunWieldPrimitives.jsx`.
- Use `--rw-*` semantic tokens and the theme bridge, never hard-coded colors. Bridge Plannotator's Tailwind/Radix tokens
  back to `--rw-*` rather than adopting a separate visual identity.
- Before adding a visual pattern, check whether an existing one covers it. If a new one is genuinely needed, document it
  in `docs/design-system.md` and add it to the shared design-system layer in the same change.
