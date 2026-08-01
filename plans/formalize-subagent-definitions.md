---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Give the workflow-dispatched subagent prompts one home and one typed loader, replacing four hand-rolled prompt readers that have already drifted."
affectedPaths:
    - "src/agent-definitions/subagent-definitions/"
    - "src/shared/session/subagent-definitions.ts"
    - "src/shared/workflow/validation-legacy.ts"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/tools/delegate-agent.js"
    - "src/cmd/init/index.js"
    - "src/constants.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-01T00:32:24-04:00"
status: "draft"
---

# Formalize Subagent Definitions

## Context

RunWield now dispatches seven prompts that a user never selects: Delegated Agent, Reviewer (discovery), Reviewer
(verify), Reviewer-Feedback Engineer, Manual QA, Slicer, and Init. They live in
`src/agent-definitions/workflow-prompts/` — a directory named for where they are used rather than for what they are —
and each is loaded by its own hand-rolled reader:

- `loadDelegatedAgentPrompt` (`src/tools/delegate-agent.js:124`) — `extractYaml` inline, no retry.
- `loadReviewerPrompt` (`validation-legacy.ts:305`) and `loadManualQaPrompt` (`validation-legacy.ts:356`) — identical
  bodies apart from the filename and the fallback display name, both going through the private
  `readBundledPromptFrontMatter` helper, which has retry and a direct-read fallback that `delegate-agent.js` lacks.
- `loadReviewerFeedbackEngineerDef` (`validation-legacy.ts:341`) and the Slicer loader (`workflow-slicer.js:465`) — a
  second shape entirely, going through `loadAgentDefFromPath` for a full agent definition.
- `src/cmd/init/index.js:158` — a bare `ensureBundledAgentDefFile` call with a comment explaining the identifier is
  "init" rather than the file's basename.

Four of these were written independently, so they already disagree about retry behavior, front-matter defaults, and
whether a subagent gets the shared system prompt. Adding an eighth (the delegate_agent verification-adversary role)
means writing a fifth reader, and the composition work in `agent-prompt-architecture-notes.md` needs a single assembly
seam to hang shared practice on.

## Objective

One directory and one typed loader own every workflow-dispatched subagent prompt, so adding a subagent is a data change
and the behavior of loading one is defined in exactly one place.

This is a pure refactor: no subagent gains, loses, or changes a capability, and no prompt text changes.

## Approach

Move the prompts to `src/agent-definitions/subagent-definitions/` — nested under the existing agent-definitions tree
rather than a top-level sibling. `extractBundledAgentDefs` (`agent-assets.js:64`) copies that whole tree into the
`~/.wld/bundled-agent-definitions` cache, and the compiled-binary and container-image checks
(`scripts/build-plan-server-runtime.js`, `scripts/assert-plan-server-image.js`) enumerate it. A top-level
`src/subagent-definitions/` would need a third extraction pipeline alongside agent defs and skills to buy a naming
preference. The directory name carries the distinction; the location keeps the asset machinery.

`src/shared/session/subagent-definitions.ts` exports one `loadSubAgentDefinition(id)` plus a `SubAgentDefinition` type
and a registry keyed by subagent id. The registry entry — not the call site — declares the two things that currently
vary: which markdown file backs the subagent, and whether it loads as a bare prompt (front matter + body only, no tools,
no shared system prompt) or as a full agent definition via `loadAgentDefFromPath`. The retry-and-fallback behavior
currently private to `validation-legacy.ts` becomes the shared path, so `delegate-agent.js` stops being the one loader
that can fail on a cold cache.

Per the house typing style, the shared shapes are named once in the module and referenced; call sites do not restate
them inline.

## Files to Modify

- `src/agent-definitions/subagent-definitions/*.md` — the seven prompts, moved with `git mv`, content unchanged.
- `src/shared/session/subagent-definitions.ts` — new: `SubAgentDefinition`, the registry, `loadSubAgentDefinition`.
- `src/shared/workflow/validation-legacy.ts` — the four reviewer/QA loaders delegate to it;
  `readBundledPromptFrontMatter` and the per-file path constants are removed.
- `src/shared/workflow/workflow-slicer.js` — Slicer loads through it.
- `src/tools/delegate-agent.js` — `loadDelegatedAgentPrompt` delegates to it.
- `src/cmd/init/index.js` — Init loads through it.
- `src/constants.js` — subagent ids alongside `AGENTS`; the comments at `:335-344` explaining the old path-based loading
  are reconciled with the registry.

## Reuse Opportunities

- `src/shared/session/agent-assets.js` — `ensureBundledAgentDefFile` stays the asset seam; the new module is its only
  subagent-side caller.
- `src/shared/workflow/validation-legacy.ts:129` — `readBundledPromptFrontMatter`, including its retry loop, recoverable
  error test, and `AGENT_DEFS_DIR` direct-read fallback: move it rather than rewrite it.
- `loadAgentDefFromPath` — unchanged for the two subagents that are real execution agents.
- `src/shared/session/types.js` — `AgentDefinition` remains the returned shape, so no call site changes what it does
  with the result.

## Implementation Steps

- [ ] `src/agent-definitions/subagent-definitions/` contains the seven prompt files moved via `git mv` with
      byte-identical content, and `src/agent-definitions/workflow-prompts/` no longer exists.
- [ ] `src/shared/session/subagent-definitions.ts` exports the `SubAgentDefinition` type, a `SUBAGENTS` registry mapping
      each subagent id to its file and load mode, and `loadSubAgentDefinition(id, deps?)` returning an
      `AgentDefinition`. The retry, recoverable-error, and direct-read fallback behavior from
      `readBundledPromptFrontMatter` is in this module.
- [ ] `loadReviewerPrompt`, `loadReviewerFeedbackEngineerDef`, and `loadManualQaPrompt` in `validation-legacy.ts` are
      thin wrappers over `loadSubAgentDefinition` that keep their current exported signatures and injectable deps;
      `readBundledPromptFrontMatter`, `WORKFLOW_PROMPTS_DIR`, and the four prompt-file constants no longer exist in that
      file.
- [ ] `loadDelegatedAgentPrompt` in `delegate-agent.js` resolves through `loadSubAgentDefinition` and gains the retry
      behavior it lacks today; `WORKFLOW_PROMPTS_DIR` and `DELEGATED_PROMPT_FILE` no longer exist in that file.
- [ ] `workflow-slicer.js` and `cmd/init/index.js` load their prompts through `loadSubAgentDefinition`; neither file
      contains a `workflow-prompts` path literal.
- [ ] `src/shared/session/subagent-definitions.test.ts` proves each registered subagent loads, that a bare-prompt
      subagent returns no tools and a full-definition subagent returns the shared system prompt, and that a cold cache
      followed by a transient read failure still resolves.
- [ ] `scripts/build-plan-server-runtime.js`, `scripts/assert-plan-server-image.js`, and any path fixtures in their
      tests reference the new directory, and the container image still excludes the prompts it excluded before.

## Verification Plan

- Automated: `deno task ci`.
- Automated: `deno task test:golden-tui` — the Golden portfolio exercises Reviewer, Reviewer-Feedback Engineer, Manual
  QA, Slicer, and Delegated Agent end to end. Those journeys must pass unchanged, which is the real behavioral proof
  that the loader swap is transparent.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts
  src/shared/workflow/validation-prompts.test.js src/tools/__tests__/delegate-agent.test.js src/cmd/init/`
- Manual: run a compiled binary (`deno task compile` output) once with a cleared `~/.wld/bundled-agent-definitions`
  cache and start a Delegated Agent, to prove asset extraction still finds the moved directory.
- Existing behavior to preserve: every subagent's prompt text, display name, tool set, `/agent` invisibility, and
  `return_to_router` exclusion. The Reviewer's discovery/verify mode split stays a parameter, not two registry entries
  with divergent behavior.
- Behavior expected to stop existing: `delegate-agent.js` failing on a transient cold-cache read, since it now shares
  the retry path.

### Objective-Failing Checks

- `OC1` — `! test -d src/agent-definitions/workflow-prompts` — the old directory is gone, not merely duplicated.
- `OC2` — `test "$(grep -rl 'workflow-prompts' src --include='*.js' --include='*.ts' | wc -l)" -eq 0` — no call site
  still resolves a prompt by the old path.
- `OC3` —
  `! grep -q 'ensureBundledAgentDefFile' src/shared/workflow/validation-legacy.ts src/tools/delegate-agent.js src/shared/workflow/workflow-slicer.js src/cmd/init/index.js`
  — the four hand-rolled readers route through the loader instead of reaching for the asset seam themselves.
- `OC4` — `deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts` — the loader
  exists and its registry is exercised.

## Edge Cases & Considerations

- **A refactor plan is exactly where placeholder completion hides.** `OC1`–`OC3` are shaped to fail on a rename plus
  re-export: the old directory must be absent and no file may keep its own reader.
- `validation-legacy.ts` currently does not type-check cleanly in isolation; the wrappers must not widen its existing
  looseness into the new module, which is typed properly per the house style.
- `AGENTS.REVIEWER_FEEDBACK_ENGINEER` and friends are load-bearing identifiers in lifecycle records and metrics.
  Subagent ids may reuse those constants but must not change their string values, or historical Work Records and metrics
  stop joining.
- Init's loader is deliberately keyed "init" rather than the file basename (`cmd/init/index.js:157`). Preserve that
  mapping in the registry rather than silently renaming the agent identifier.
- The container-image policy scripts assert which prompt files may ship in the plan-server image. Moving the directory
  without updating them either breaks the build or silently ships prompts that were previously excluded — check both
  directions.
