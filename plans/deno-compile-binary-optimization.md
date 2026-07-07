---
planId: "accb15c0-92a5-4328-b755-a0534d844f2a"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement improvements to deno compile for smaller binaries and optimized path resolution for bundled agent definitions and skills, as described in the Deno v2.9 blog post."
affectedPaths:
    []
frontend: false
createdAt: "2026-07-06T16:52:46-04:00"
updatedAt: "2026-07-07T01:20:38.434Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-06T22:57:31.195Z"
verifiedAt: "2026-07-07T01:20:38.434Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "deno compile binary optimization"
---

# Deno Compile Binary Optimization

## Context

RunWield builds a standalone `wld` binary with `scripts/compile.js`. The current compile command uses repeated
`--include` flags for static resource directories such as bundled agent definitions, workflow prompts, prompt templates,
bundled skills, Snip filters, workspace CSS, and theme JSON. Deno 2.9 adds two relevant compile improvements:

- `--include-as-is` embeds files/directories verbatim without trying to resolve or transpile embedded `.js`/`.ts` files
  as modules. This is the correct fit for RunWield's Markdown/YAML/CSS/JSON bundled resources.
- Experimental `--bundle` runs the entrypoint through Deno's bundler first, avoiding the default behavior of embedding
  the entire resolved `node_modules` tree. `--minify` can further shrink the embedded bundle.

The repository is already on Deno 2.9.1 locally. Discovery note: the installed `deno compile --help` exposes `--bundle`,
`--minify`, `--app-name`, and `--exclude-unused-npm`, but did not expose `--include-as-is` despite the Deno 2.9
blog/docs mentioning it. The implementation should detect support for `--include-as-is` and fall back to `--include`
with an explanatory warning until the local/CI Deno version supports the flag. The main risks are compile-bundle
compatibility with dynamic imports/package asset reads and preserving the runtime-readable path behavior used by bundled
agent definitions and skills. Bundled skills and agent definitions are currently copied out of the compile virtual
filesystem to `~/.wld/bundled-skills` and `~/.wld/bundled-agent-definitions` so external tools can read them by absolute
path.

## Objective

Update the compile pipeline and resource path handling so `deno task compile` produces a smaller binary using Deno 2.9
features while preserving these behaviors:

- `./bin/wld help` works from the compiled binary.
- Standard bundled agent definitions load from the binary.
- workflow-only prompts (`init`, `slicer`, `reviewer`) resolve from bundled resources.
- bundled skills are advertised with readable paths and `/skill:*` expansion still works.
- prompt templates, Snip filters, workspace static CSS, and theme JSON remain readable in source and compiled runs.
- Plannotator plan/code review assets still resolve despite `--bundle` no longer embedding the whole `node_modules` tree
  by default.

## Approach

Use `--bundle --minify` for smaller artifacts, prefer `--include-as-is` for static resources when the active Deno CLI
supports it, fall back to `--include` when it does not, and make bundled resource resolution explicit enough that source
runs and compiled runs use the same path expectations. Keep the fallback visible in compile output so a future Deno
upgrade can switch to the verbatim include path automatically.

The preferred implementation is not to enable `--self-extracting` globally. RunWield only needs real on-disk paths for
resources that external tools read directly, and the existing extraction cache pattern already handles bundled skills
and agent definitions. Internal resources can continue to be read from Deno's compile virtual filesystem via
`import.meta.dirname`-derived paths.

Because `--bundle` can omit untraced `node_modules` assets, explicitly account for any package asset that RunWield reads
by filesystem path. The known case is `node_modules/@gandazgul/plannotator-pi-extension-compiled/review-editor.html` in
`src/shared/workflow/code-review.js`. The installed package exports `./assets`, but discovery showed that export only
contains `plannotatorHtml`; it does not expose `review-editor.html`, so the practical near-term path is an explicit
compile include for that HTML file unless the dependency is upgraded.

## Files to Modify

- `scripts/compile.js` — add Deno 2.9 compile flags (`--bundle`, `--minify`, `--app-name wld`), refactor compile-arg
  construction into testable pure helpers, prefer `--include-as-is` for static asset includes when supported, fall back
  to `--include` when unsupported, remove redundant workflow prompt includes already covered by `src/agent-definitions`,
  and explicitly include any package HTML asset still read by path.
- `scripts/compile.test.js` — replace string-only assertions for old `--include` behavior with assertions for the pure
  compile-arg builder: `--bundle`, `--minify`, include-flag selection/fallback, the bundled resource directories, and
  the Plannotator review asset if still filesystem-read.
- `src/constants.js` — clarify/centralize bundled resource path constants so they are documented as source-run and
  compiled-VFS compatible; add package/resource constants only if needed to avoid hard-coded path drift.
- `src/shared/session/session.js` — keep extraction for bundled skills and bundled agent definitions, and update
  comments/tests if resource path constants are centralized. Avoid extracting every bundled resource unless a caller
  needs a real filesystem path.
- `src/shared/session/agents.js` — make standard agent discovery use the same bundled agent definitions root if
  centralization requires it; preserve local > home > bundled layering.
- `src/shared/snip-filters.js` — reuse central bundled Snip filter path if introduced; preserve current install/cleanup
  behavior.
- `src/shared/workflow/code-review.js` — keep the current dependency-injected `loadReviewEditorHtml` seam; if the
  dependency later exposes review HTML as JS, switch to that pattern, but for this plan document/test the explicit
  compile include because the current `./assets` export only exposes plan-review HTML.
- `src/shared/workflow/code-review.test.js` — add focused coverage for the default review HTML loader if practical, or
  leave existing dependency-injected tests and rely on compiled smoke verification for the package HTML asset.
- `src/shared/session/session-catalog.test.js` — keep/adjust coverage for bundled skill extraction, workflow prompt
  resolution, and bundled path reporting.
- `src/shared/snip-filters.test.js` — add or update coverage that Snip filters still read from the bundled directory in
  source-mode tests.
- `README.md`, `docs/quickstart.md` — optionally mention that building the standalone binary requires Deno 2.9+ if the
  existing contributor docs need a version note.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `scripts/compile.js` — current compile wrapper and `scripts/write-version.js` pre-step.
- `src/constants.js` — existing `SRC_DIR`-derived resource constants (`AGENT_DEFS_DIR`, `PROMPT_TEMPLATES_DIR`,
  `SKILLS_DIR`).
- `src/shared/session/session.js` — `copyTreeFromBundle`, `extractBundledSkills`, `extractBundledAgentDefs`, and
  `ensureBundledAgentDefFile` for resources that external tools need as real files.
- `src/shared/session/agents.js` — existing layered agent definition discovery and merge behavior.
- `src/shared/workflow/submit-plan.js` — compile-safe pattern of consuming Plannotator HTML from an exported JS asset
  instead of runtime package filesystem lookup.

## Implementation Steps

- [ ] Step 1: Refactor `scripts/compile.js` behind `import.meta.main` so tests can import pure helpers such as
      `buildCompileArgs()` and `selectStaticIncludeFlag()` without running the build.
- [ ] Step 2: Update the compile args to build with
      `deno compile -A --bundle --minify --app-name wld --output ./bin/wld src/cli.js` plus resource includes. Consider
      `--exclude-unused-npm` only as a fallback experiment if `--bundle` proves incompatible during verification.
- [ ] Step 3: Prefer `--include-as-is` for RunWield static resources when `deno compile --help` reports support;
      otherwise use `--include` and print a clear warning that this Deno version lacks `--include-as-is`. Apply the
      selected flag to `src/ui/workspace/static/`, `src/agent-definitions`, `src/prompt-templates`,
      `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md`, `src/skills`, `src/snip-filters`, and
      `src/shared/ui/catppuccin-mocha.json`.
- [ ] Step 4: Remove redundant or commented workflow-prompt file includes once `src/agent-definitions` covers
      `workflow-prompts/`; keep explicit tests that the real files are covered by the directory include.
- [ ] Step 5: Audit filesystem reads of package assets that `--bundle` may not embed. For the known `review-editor.html`
      path, add it to the same selected static include mechanism as
      `node_modules/@gandazgul/plannotator-pi-extension-compiled/review-editor.html` unless a dependency upgrade exposes
      a review HTML JS export.
- [ ] Step 6: If path constants need centralization, keep the implementation pure JavaScript/JSDoc and route bundled
      path consumers through one module or clearly documented constants. Preserve source-run behavior and Deno compile
      virtual filesystem behavior.
- [ ] Step 7: Preserve extraction only where needed for external absolute-path reads: bundled skills and bundled agent
      definitions. Do not make the binary self-extracting unless verification proves a dependency needs real files.
- [ ] Step 8: Update compile/resource tests to assert the new flags and runtime resource coverage without depending on
      stale commented strings.
- [ ] Step 9: Update contributor docs only if a Deno 2.9+ note is needed for `deno task compile`.

## Verification Plan

- Automated: `deno task ci`
- Automated: `deno task compile` (output should show whether `--include-as-is` or the compatibility `--include` fallback
  was used)
- Automated/manual smoke: `./bin/wld help`
- Manual smoke: run a compiled command or minimal session path that lists agents/skills if feasible without requiring
  model credentials; confirm bundled agent definitions and skills are found.
- Manual smoke: verify workflow prompt assets can be read from the compiled binary path by exercising an existing
  command that loads them where practical, or add/temporarily run a focused test helper if interactive model execution
  would be required.
- Manual smoke: verify Plannotator/code-review asset resolution still works or is covered by a non-interactive test
  path.
- Expected results: compile succeeds on Deno 2.9+, binary starts, bundled resources load in both source and compiled
  runs, and binary size is smaller than the pre-change compile artifact when measured on the same machine/target.

## Edge Cases & Considerations

- `--bundle` is experimental in Deno 2.9 and can miss dynamic `import()`/`require()` patterns that are not statically
  analyzable. If verification exposes a real runtime break, prefer making that import/path explicit over dropping
  bundling entirely.
- `--minify` can make stack traces less readable. This is acceptable for release-sized binaries, but if debugging
  compiled builds becomes painful, consider making minification opt-out via an environment variable in
  `scripts/compile.js`.
- `--bundle` no longer embeds the whole `node_modules` tree, so any runtime `Deno.readTextFile` into a package must be
  converted to an exported JS asset or explicitly included.
- `--include-as-is` should be used only for passive resources and only when the active Deno CLI supports it. Source
  modules/workers that must participate in module resolution should remain normal imports or use `--include` only when
  necessary.
- Avoid `--self-extracting` unless needed: it increases first-run startup cost, disk usage, memory usage, and tamper
  surface. Existing targeted extraction for skills/agent definitions is safer.
- The repository has unrelated dirty files at planning time; execution should avoid touching them and only modify the
  paths in this plan.
