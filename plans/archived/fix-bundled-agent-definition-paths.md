---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "LLMs are attempting to read bundled agent definition files (e.g., `src/agent-definitions/plan-formats/planner-plan-format.md`) using relative paths that only exist in the Harns source tree, but not in the project they are currently working on. When Harns is compiled into a binary, these files are embedded. We need to implement a mechanism similar to `extractBundledSkills` that extracts these bundled agent definitions and related assets to a cache directory in `~/.hns/`, and then provide the LLM with the correct absolute paths to these cached files in the system prompt."
affectedPaths:
    - "src/shared/session/session.js"
createdAt: "2026-06-02T15:54:37Z"
updatedAt: "2026-06-02T15:54:46.061Z"
status: "completed"
origin: "internal"
---

# Fix bundled agent-definition path references for compiled binary runs

## Context

Planner/architect/slicer instructions currently reference `src/agent-definitions/...` paths. When `hns` runs in another
project via compiled binary, those source-relative paths do not exist in that project, so `read` calls fail with ENOENT.

## Objective

Make bundled agent-definition assets available on real disk paths and ensure agent prompts point to those real paths, so
file tools can access plan format files regardless of current working directory.

## Approach

Mirror the existing bundled-skills extraction pattern:

1. Extract bundled `src/agent-definitions` to a stable cache directory under `~/.hns/`.
2. Thread the resolved extracted directory into system prompt assembly via a placeholder.
3. Replace hardcoded `src/agent-definitions/...` references in agent prompts/workflow strings with that
   placeholder-backed absolute path.

## Files to Modify

- `src/shared/session/session.js` — add extraction/cache logic for bundled agent definitions and placeholder
  substitution in `assembleFinalSystemPrompt`.
- `src/agent-definitions/planner.md` — change plan-format path instruction to placeholder-based absolute path.
- `src/agent-definitions/architect.md` — same replacement for architect plan format path.
- `src/agent-definitions/slicer.md` — same replacement for slicer tasks format path.
- `src/shared/workflow/workflow.js` — update slicer task prompt string to use the same placeholder-resolved path style.
- `src/shared/workflow/workflow.test.js` — update/add expectations around slicer request wording after removing
  source-relative path instructions.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` → `copyTreeFromBundle` and `extractBundledSkills()` pattern for extracting compiled-in
  files to real disk.
- `src/constants.js` → `AGENT_DEFS_DIR` and `HOME_DIR` as bundled source/cache roots.
- `src/shared/session/session.js` → `assembleFinalSystemPrompt()` placeholder replacement flow.

## Implementation Steps

- [ ] In `session.js`, add bundled agent-def extraction support (parallel to `extractBundledSkills`) with cache
      directory `~/.hns/bundled-agent-definitions` and one-time-per-process extraction semantics.
- [ ] Add a helper exported from `session.js` that resolves the runtime-readable bundled agent-def root
      (`extracted cache` when available, fallback `AGENT_DEFS_DIR` when not).
- [ ] Extend `assembleFinalSystemPrompt()` to replace a new placeholder token `{{BUNDLED_AGENT_DEFS_DIR}}` using that
      resolver.
- [ ] Update `planner.md`, `architect.md`, and `slicer.md` to reference plan-format files via
      `{{BUNDLED_AGENT_DEFS_DIR}}/plan-formats/...`.
- [ ] Update `workflow.js` `buildSlicerRequest()` string to remove the source-relative path
      (`src/agent-definitions/...`) and instead instruct slicer to use the path in its system prompt (avoids passing
      unresolved source paths in user request text).
- [ ] Add/update tests:
  - `workflow.test.js` expectations for the revised `buildSlicerRequest()` wording.
  - `session.js`-adjacent unit coverage for placeholder replacement + fallback path behavior (new test file if needed).
- [ ] Validate prompt assembly + planning flows still work in source mode and compiled-binary mode.

## Verification Plan

- Automated:
  - `deno test src/shared/workflow/workflow.test.js`
  - `deno test src/shared/session/__tests__/*.test.js`
  - `deno run ci`
- Manual:
  - Run `hns` from a different repo directory.
  - Trigger planner/architect/slicer flows that read plan format files.
  - Confirm tool calls use the extracted absolute path under `~/.hns/...` and no ENOENT occurs.
- Expected results:
  - Planner/architect/slicer can successfully `read` format files in compiled binary mode.
  - Source-run mode still works (fallback path remains valid).

## Edge Cases & Considerations

- Extraction directory refresh policy should avoid stale bundled prompts after binary updates (overwrite cache per
  process startup, matching bundled-skills behavior).
- If `HOME` is unavailable, fallback must still produce a usable path (`AGENT_DEFS_DIR`) without crashing prompt
  assembly.
- Keep placeholder replacement narrowly scoped to agent system-prompt assembly so user/project content is untouched.
- Ensure instructions remain readable and stable in both source and compiled execution modes.
