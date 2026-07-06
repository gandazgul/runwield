---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Use Deno 2.9 compile asset/bundling improvements to reduce the wld binary size while preserving bundled resource path resolution."
affectedPaths:
    - "scripts/compile.js"
    - "scripts/compile.test.js"
    - "src/constants.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agents.js"
    - "src/shared/snip-filters.js"
    - "src/shared/workflow/code-review.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/snip-filters.test.js"
    - "docs/quickstart.md"
    - "README.md"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-06T16:52:46-04:00"
status: "draft"
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

The repository is already on Deno 2.9.1 locally. The main risks are compile-bundle compatibility with dynamic
imports/package asset reads and preserving the runtime-readable path behavior used by bundled agent definitions and
skills. Bundled skills and agent definitions are currently copied out of the compile virtual filesystem to
`~/.wld/bundled-skills` and `~/.wld/bundled-agent-definitions` so external tools can read them by absolute path.

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

Use `--bundle --minify` for smaller artifacts, convert static resource includes from `--include` to `--include-as-is`,
and make bundled resource resolution explicit enough that source runs and compiled runs use the same path expectations.

The preferred implementation is not to enable `--self-extracting` globally. RunWield only needs real on-disk paths for
resources that external tools read directly, and the existing extraction cache pattern already handles bundled skills
and agent definitions. Internal resources can continue to be read from Deno's compile virtual filesystem via
`import.meta.dirname`-derived paths.

Because `--bundle` can omit untraced `node_modules` assets, explicitly account for any package asset that RunWield reads
by filesystem path. The known case is `node_modules/@gandazgul/plannotator-pi-extension-compiled/review-editor.html` in
`src/shared/workflow/code-review.js`; either include it with `--include-as-is` or switch the code to a compile-safe
exported asset if the package exposes one.

## Files to Modify

- `scripts/compile.js` — add Deno 2.9 compile flags (`--bundle`, `--minify`, `--app-name wld`), convert static asset
  includes to `--include-as-is`, remove redundant workflow prompt includes already covered by `src/agent-definitions`,
  and explicitly include any package HTML asset still read by path.
- `scripts/compile.test.js` — replace string-only assertions for old `--include` behavior with assertions for
  `--bundle`, `--minify`, `--include-as-is`, the bundled resource directories, and the Plannotator review asset if still
  filesystem-read.
- `src/constants.js` — clarify/centralize bundled resource path constants so they are documented as source-run and
  compiled-VFS compatible; add package/resource constants only if needed to avoid hard-coded path drift.
- `src/shared/session/session.js` — keep extraction for bundled skills and bundled agent definitions, and update
  comments/tests if resource path constants are centralized. Avoid extracting every bundled resource unless a caller
  needs a real filesystem path.
- `src/shared/session/agents.js` — make standard agent discovery use the same bundled agent definitions root if
  centralization requires it; preserve local > home > bundled layering.
- `src/shared/snip-filters.js` — reuse central bundled Snip filter path if introduced; preserve current install/cleanup
  behavior.
- `src/shared/workflow/code-review.js` — remove or guard the filesystem read of `review-editor.html` if a package export
  is available; otherwise document and rely on the explicit `--include-as-is` compile asset.
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

- [ ] Step 1: Update `scripts/compile.js` to build with
      `deno compile -A --bundle --minify --app-name wld --output ./bin/wld src/cli.js` plus resource includes.
- [ ] Step 2: Convert RunWield static resource flags to `--include-as-is`: `src/ui/workspace/static/`,
      `src/agent-definitions`, `src/prompt-templates`, `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md`, `src/skills`,
      `src/snip-filters`, and `src/shared/ui/catppuccin-mocha.json`.
- [ ] Step 3: Remove redundant or commented workflow-prompt file includes once `src/agent-definitions` covers
      `workflow-prompts/`; keep explicit tests that the real files are covered by the directory include.
- [ ] Step 4: Audit filesystem reads of package assets that `--bundle` may not embed. For the known `review-editor.html`
      path, either switch to a package-exported string asset if available or add
      `--include-as-is node_modules/@gandazgul/plannotator-pi-extension-compiled/review-editor.html`.
- [ ] Step 5: If path constants need centralization, keep the implementation pure JavaScript/JSDoc and route bundled
      path consumers through one module or clearly documented constants. Preserve source-run behavior and Deno compile
      virtual filesystem behavior.
- [ ] Step 6: Preserve extraction only where needed for external absolute-path reads: bundled skills and bundled agent
      definitions. Do not make the binary self-extracting unless verification proves a dependency needs real files.
- [ ] Step 7: Update compile/resource tests to assert the new flags and runtime resource coverage without depending on
      stale commented strings.
- [ ] Step 8: Update contributor docs only if a Deno 2.9+ note is needed for `deno task compile`.

## Verification Plan

- Automated: `deno task ci`
- Automated: `deno task compile`
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
- `--include-as-is` should be used only for passive resources. Source modules/workers that must participate in module
  resolution should remain normal imports or use `--include` only when necessary.
- Avoid `--self-extracting` unless needed: it increases first-run startup cost, disk usage, memory usage, and tamper
  surface. Existing targeted extraction for skills/agent definitions is safer.
- The repository has unrelated dirty files at planning time; execution should avoid touching them and only modify the
  paths in this plan.
