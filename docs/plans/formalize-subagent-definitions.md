---
planId: "069d2ec8-ab4a-47cd-969b-fb3ee4d811ea"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Give the workflow-dispatched subagent prompts one home and one typed loader, replacing four hand-rolled prompt readers that have already drifted."
affectedPaths:
    - "src/agent-definitions/subagent-definitions/"
    - "src/shared/session/subagent-definitions.ts"
    - "src/shared/session/subagent-definitions.test.ts"
    - "src/shared/session/agents.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/workflow/validation-prompts.ts"
    - "src/shared/workflow/validation-prompts.test.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/tools/delegate-agent.js"
    - "src/tools/__tests__/delegate-agent.test.js"
    - "src/cmd/init/index.js"
    - "src/cmd/init/index_test.js"
    - "src/constants.js"
    - "scripts/compile.test.js"
    - "scripts/assert-plan-server-image.test.js"
    - "scripts/build-plan-server-runtime.test.js"
    - "scripts/injection-seam-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "test ! -d src/agent-definitions/workflow-prompts"
      rationale: "The old workflow-prompts directory exists on the baseline and can only disappear once the prompt files have been moved rather than duplicated."
    - id: "OC2"
      command: "bash -c 'git grep -n workflow-prompts -- src scripts | grep -v \"workflow-prompts\\\\.js\" >/dev/null && exit 1 || exit 0'"
      rationale: "This fails while source or script files still reference the old workflow prompt asset path, while ignoring legitimate imports of the unrelated workflow-prompts.js module."
    - id: "OC3"
      command: "bash -c 'grep -Eq \"ensureBundledAgentDefFile|loadAgentDefFromPath|WORKFLOW_PROMPTS_DIR\" src/shared/workflow/validation-prompts.ts src/tools/delegate-agent.js src/shared/workflow/workflow-slicer.js src/cmd/init/index.js && exit 1 || exit 0'"
      rationale: "The current hand-rolled call sites import or define these direct loading pieces; the check can only pass when those call sites delegate prompt loading to the new shared loader."
    - id: "OC4"
      command: "deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts"
      rationale: "The focused test file does not exist on the baseline and can only pass once the typed loader and registry are implemented and exercised."
objectiveChecksBaseline:
    recordedAt: "2026-08-02T12:54:55.793Z"
    head: "1faf32283e198393ff9e93e79b28dd21755dc0c0"
    results:
        - id: "OC1"
          command: "test ! -d src/agent-definitions/workflow-prompts"
          rationale: "The old workflow-prompts directory exists on the baseline and can only disappear once the prompt files have been moved rather than duplicated."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 5
          output: "\n"
        - id: "OC2"
          command: "bash -c 'git grep -n workflow-prompts -- src scripts | grep -v \"workflow-prompts\\\\.js\" >/dev/null && exit 1 || exit 0'"
          rationale: "This fails while source or script files still reference the old workflow prompt asset path, while ignoring legitimate imports of the unrelated workflow-prompts.js module."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 40
          output: "\n"
        - id: "OC3"
          command: "bash -c 'grep -Eq \"ensureBundledAgentDefFile|loadAgentDefFromPath|WORKFLOW_PROMPTS_DIR\" src/shared/workflow/validation-prompts.ts src/tools/delegate-agent.js src/shared/workflow/workflow-slicer.js src/cmd/init/index.js && exit 1 || exit 0'"
          rationale: "The current hand-rolled call sites import or define these direct loading pieces; the check can only pass when those call sites delegate prompt loading to the new shared loader."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 14
          output: "\n"
        - id: "OC4"
          command: "deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts"
          rationale: "The focused test file does not exist on the baseline and can only pass once the typed loader and registry are implemented and exercised."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/src/shared/session/subagent-definitions.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
          exitCode: 1
          durationMs: 59
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/src/shared/session/subagent-definitions.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-formalize-subagent-definitions-c332e4dd/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T00:32:24-04:00"
updatedAt: "2026-08-02T15:21:18.877Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-02T13:23:57.923Z"
verifiedAt: "2026-08-02T15:00:35.739Z"
userVerifiedAt: null
executionReport: "- Implemented: moved all seven workflow-dispatched prompt files to `src/agent-definitions/subagent-definitions/` with 100% rename content preservation, removed the old directory, added `SUBAGENTS` plus the typed `loadSubAgentDefinition` registry/loader.\n- Implemented: validation, delegate-agent, slicer, and init call sites now delegate through the shared loader; obsolete direct prompt-file/loading seams were removed and the injection-seam baseline was tightened.\n- Tests updated/added: added `src/shared/session/subagent-definitions.test.ts` (+6 tests); no test cases were removed. Updated existing validation/delegation/slicer/init/session-catalog/compile/runtime/image tests for the new path and preserved prior behavior assertions.\n- Verification passed: objective checks OC1–OC4; targeted suite (`143 passed`); `deno task seams:check`; `deno task ci` (`233 files passed`); `deno task test:golden-tui` (`56 passed`, after rerunning one initial timeout successfully); `deno task compile`.\n- Manual compiled-binary check: cleared a temp `HOME` bundled-agent-definitions cache and ran `./bin/wld --help` successfully; a live Delegated Agent start remains unverified because this environment has no configured noninteractive model/provider session for that manual flow."
workRecord:
    status: "generated"
    recordId: "52b2953d-e0c4-4734-8d39-68feee925a28"
    path: "docs/work-records/2026-08-02-formalized-subagent-definition-loading.md"
    lastAttemptAt: "2026-08-02T15:21:18.807Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-02T13:31:45.595Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "fde54d43986f020715022773f098506330c566e3"
    targetBranch: "main"
    targetHeadBeforeMerge: "92bf9a7eac8132f04cfa62755bf7ae210d059f0d"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Formalize Subagent Definitions

## Context

RunWield dispatches seven prompt files that a user never selects directly: Delegated Agent, Reviewer discovery, Reviewer
verify, Reviewer-Feedback Engineer, Manual QA, Slicer, and Init. They currently live in
`src/agent-definitions/workflow-prompts/` — a directory named for where the prompts are used rather than what they are —
and they are still loaded through several separate paths:

- `loadDelegatedAgentPrompt` (`src/tools/delegate-agent.js:124`) parses front matter inline and has no retry/fallback
  path for a first-use bundled asset cache refresh.
- `loadReviewerPrompt`, `loadReviewerFeedbackEngineerDef`, and `loadManualQaPrompt`
  (`src/shared/workflow/validation-prompts.ts`) share a validation-only helper, but that helper is private to Workflow
  Validation and cannot be reused by Delegated Agent, Slicer, or Init.
- `loadSlicerAgentDef` (`src/shared/workflow/workflow-slicer.js:465`) loads a full agent definition by joining the old
  directory literal and calling `loadAgentDefFromPath` directly.
- `runInitCommand` (`src/cmd/init/index.js:158`) directly calls `ensureBundledAgentDefFile` and then
  `loadAgentDefFromPath`, with a comment explaining that the canonical runtime identifier is `init` rather than the file
  basename.

That means the same product concept — a workflow-dispatched prompt hidden from `/agent` — is split across call sites,
with different retry behavior, different front-matter defaults, and different decisions about whether the shared system
prompt is applied. Adding another workflow-dispatched role would still require choosing or copying one of these readers.

## Objective

One directory and one typed loader own every workflow-dispatched subagent prompt, so adding a subagent is a registry
data change and loading behavior is defined in exactly one place.

This is a pure refactor: no subagent gains, loses, or changes a capability, and no prompt text changes.

## Approach

Move the prompts to `src/agent-definitions/subagent-definitions/` using `git mv`. Keeping the directory under
`src/agent-definitions/` preserves the existing asset pipeline: `extractBundledAgentDefs` copies the whole tree into
`~/.wld/bundled-agent-definitions`, and `scripts/compile.js` already includes `src/agent-definitions/` in compiled
binaries. A top-level `src/subagent-definitions/` would require a new extraction/include pipeline just to buy a naming
preference.

Add `SUBAGENTS` constants alongside `AGENTS` in `src/constants.js`. `SUBAGENTS` are registry keys for hidden
workflow-dispatched definitions; they do not replace historical runtime agent names. Each registry entry declares the
returned `agentName` (`AGENTS.REVIEWER`, `AGENTS.SLICER`, `AGENTS.INIT`, `AGENTS.DELEGATED`,
`AGENTS.REVIEWER_FEEDBACK_ENGINEER`, or `AGENTS.OPERATOR` for Manual QA), so lifecycle records, metrics, display-name
fallbacks, and isolated-session ownership keep their current identifiers.

Create `src/shared/session/subagent-definitions.ts` as the only subagent-side caller of `ensureBundledAgentDefFile`. It
exports named TypeScript types and `loadSubAgentDefinition(id, options?)`. The registry entry — not the caller —
declares which markdown file backs the subagent and whether it loads as:

- `barePrompt`: front matter + body only, no tools and no shared system prompt; used by Delegated Agent, Reviewer, and
  Manual QA.
- `fullAgent`: a normal agent definition loaded through `loadAgentDefFromPath`, preserving the shared system prompt and
  front-matter handling; used by Reviewer-Feedback Engineer, Slicer, and Init.

The retry/recoverable-error/direct-source fallback currently inside `validation-prompts.ts` moves into the new loader.
The Reviewer discovery/verify split remains a mode option on the Reviewer registry entry, not two independent registry
entries that can drift.

No `CONTEXT.md` update is planned: user-visible Agent, Session, Workflow Validation, and Delegated Agent Session
language does not change. `subagent-definitions` is an internal asset/module name for prompts RunWield dispatches on a
user's behalf.

## Files to Modify

- `src/agent-definitions/subagent-definitions/*.md` — seven prompt files moved with `git mv`, byte-identical content.
- `src/shared/session/subagent-definitions.ts` — new typed registry, bare-prompt/full-agent loader, retry and fallback
  behavior.
- `src/shared/session/subagent-definitions.test.ts` — new focused tests for the registry, load modes, reviewer variant,
  prompt invariants, and transient-cache recovery.
- `src/shared/workflow/validation-prompts.ts` — Workflow Validation wrappers delegate to the shared loader while keeping
  the public `loadReviewerPrompt`, `loadReviewerFeedbackEngineerDef`, and `loadManualQaPrompt` signatures.
- `src/shared/workflow/validation-prompts.test.js` — expectations reference the moved prompt path and prove wrapper
  behavior still matches current bare/full prompt contracts.
- `src/tools/delegate-agent.js` and `src/tools/__tests__/delegate-agent.test.js` — Delegated Agent prompt loading routes
  through the shared loader and gains the retry path; tests keep the context-placeholder and tool-filter guarantees.
- `src/shared/workflow/workflow-slicer.js` and `src/shared/workflow/workflow.test.js` — Slicer loads through the shared
  loader while preserving `agentName: "slicer"`, `allowReturnToRouter: false`, and current decomposition context.
- `src/cmd/init/index.js` and `src/cmd/init/index_test.js` — Init loads through the shared loader while preserving the
  `init` runtime identifier and existing init-session behavior; obsolete init test seams are removed.
- `src/constants.js` — add typed/readonly `SUBAGENTS` constants and update comments that currently describe path-based
  workflow prompt loading.
- `src/shared/session/agents.js` and `src/shared/session/session-catalog.test.js` — comments/tests that name
  `workflow-prompts` are updated without making subagents discoverable through `/agent`.
- `scripts/compile.test.js`, `scripts/build-plan-server-runtime.test.js`, and `scripts/assert-plan-server-image.test.js`
  — assertions reference the moved directory and continue proving compiled binaries include bundled definitions while
  Plan Server runtime/images exclude hidden subagent prompts.
- `scripts/injection-seam-baseline.json` — tightened after removing obsolete Init `ensureBundledAgentDefFile` and
  `loadAgentDefFromPath` test seams.

## Reuse Opportunities

- `src/shared/session/agent-assets.js` — reuse `ensureBundledAgentDefFile` and the existing bundled-agent-definitions
  extraction/cache behavior; do not create a parallel asset pipeline.
- `src/shared/workflow/validation-prompts.ts` — move the existing retry loop, recoverable-error test, front-matter
  normalization, and `AGENT_DEFS_DIR` direct-read fallback into the new module instead of reimplementing it.
- `src/shared/session/agents.js` — reuse `loadAgentDefFromPath` unchanged for full-agent subagents.
- `src/shared/session/types.js` — keep returning the existing `AgentDefinition` shape so downstream isolated-session
  callers do not need a new runtime contract.
- Existing real bundled prompt files — tests should prefer real file fixtures where possible rather than adding new
  dependency-bag seams.

## Implementation Steps

- [ ] `src/agent-definitions/subagent-definitions/` contains exactly `delegated-agent-prompt.md`,
      `init-agent-prompt.md`, `manual-qa-prompt.md`, `reviewer-feedback-engineer.md`, `reviewer-prompt.md`,
      `reviewer-verify-prompt.md`, and `slicer-prompt.md`, moved with byte-identical content;
      `src/agent-definitions/workflow-prompts/` is absent.
- [ ] `src/constants.js` exports `SUBAGENTS` registry identifiers without changing any existing `AGENTS` string values;
      comments describe subagents as hidden workflow-dispatched definitions rather than path-loaded pseudo-agents.
- [ ] `src/shared/session/subagent-definitions.ts` exports named types for subagent ids, load modes, registry entries,
      loader options, parsed front matter, and `loadSubAgentDefinition`; complex object shapes are named once and reused
      rather than written inline.
- [ ] The `SUBAGENT_DEFINITIONS` registry maps every `SUBAGENTS` id to its prompt file, display-name fallback, returned
      runtime `agentName`, and load mode. The Reviewer entry contains discovery/verify file selection under one id, and
      Manual QA returns `AGENTS.OPERATOR` without making the normal Operator definition a subagent.
- [ ] Bare-prompt loading in `subagent-definitions.ts` returns `AgentDefinition` with `model: ""`, `tools: []`, and a
      trimmed body as `systemPrompt`; it ignores prompt `tools` front matter exactly as the current Reviewer, Manual QA,
      and Delegated Agent loaders do.
- [ ] Full-agent loading in `subagent-definitions.ts` resolves the bundled prompt file and calls `loadAgentDefFromPath`
      with the registry's `agentName`, preserving shared system-prompt composition for Reviewer-Feedback Engineer,
      Slicer, and Init.
- [ ] Retry behavior from the current validation prompt helper lives only in `subagent-definitions.ts`: recoverable
      missing/partial/empty reads are retried, non-recoverable errors are rethrown, and the final fallback reads from
      `join(AGENT_DEFS_DIR, relativePath)`.
- [ ] `validation-prompts.ts`, `delegate-agent.js`, `workflow-slicer.js`, and `cmd/init/index.js` no longer import
      `ensureBundledAgentDefFile`, `loadAgentDefFromPath`, or define `WORKFLOW_PROMPTS_DIR`; they delegate prompt
      resolution to `loadSubAgentDefinition` and retain their externally used function signatures/agent names.
- [ ] Tests and comments under `src/` and `scripts/` contain no stale `workflow-prompts` asset-path references except
      legitimate imports of `src/shared/workflow/workflow-prompts.js`.
- [ ] `src/shared/session/subagent-definitions.test.ts` proves every registered subagent loads from real moved files,
      Reviewer discovery and verify choose different prompt bodies under one id, bare prompts are tool-free and do not
      include shared system-prompt markers, full-agent subagents do include shared system-prompt composition, Manual QA
      returns `operator`, Init returns `init`, and a transient cold-cache read resolves after retry.
- [ ] Existing validation, delegation, slicer, init, session-catalog, compile, Plan Server runtime, and image-policy
      tests are updated to the new directory and still protect the same behavior; `deno task seams:update` tightens the
      injection-seam baseline after removing obsolete Init seams.

## Verification Plan

- Automated: `deno task ci`.
- Automated: `deno task test:golden-tui` — the Golden portfolio exercises Reviewer, Reviewer-Feedback Engineer, Manual
  QA, Slicer, and Delegated Agent end to end. Those journeys must pass unchanged, proving the loader swap is transparent
  across workflow-dispatched subagents.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts src/shared/workflow/validation-prompts.test.js src/tools/__tests__/delegate-agent.test.js src/shared/workflow/workflow.test.js src/cmd/init/index_test.js src/shared/session/session-catalog.test.js scripts/compile.test.js scripts/build-plan-server-runtime.test.js scripts/assert-plan-server-image.test.js`.
- Automated: `deno task seams:check` after `deno task seams:update` has tightened the baseline for removed Init seams.
- Manual: run a compiled binary (`deno task compile` output) once with a cleared `~/.wld/bundled-agent-definitions`
  cache and start a Delegated Agent, to prove asset extraction still finds the moved directory in a binary install.
- Existing behavior to preserve: every subagent's prompt text, display name, runtime agent name, tool set, `/agent`
  invisibility, `return_to_router` exclusion, shared-system-prompt inclusion/exclusion, and reviewer discovery/verify
  mode selection.
- Behavior expected to stop existing: `delegate-agent.js` failing on a transient cold-cache or partial prompt read, and
  call sites resolving subagent prompt files directly instead of going through the shared loader.
- Glossary check: no `CONTEXT.md` change is expected because no user-visible domain term or relationship changes.

### Objective-Failing Checks

- `OC1` — `test ! -d src/agent-definitions/workflow-prompts` — the old directory is gone, not merely duplicated.
- `OC2` —
  `bash -c 'git grep -n workflow-prompts -- src scripts | grep -v "workflow-prompts\\.js" >/dev/null && exit 1 || exit 0'`
  — no source or script keeps an old workflow-prompt asset path; legitimate imports of the unrelated
  `workflow-prompts.js` module are ignored.
- `OC3` —
  `bash -c 'grep -Eq "ensureBundledAgentDefFile|loadAgentDefFromPath|WORKFLOW_PROMPTS_DIR" src/shared/workflow/validation-prompts.ts src/tools/delegate-agent.js src/shared/workflow/workflow-slicer.js src/cmd/init/index.js && exit 1 || exit 0'`
  — the former hand-rolled reader call sites no longer reach for the asset seam or full-agent loader directly.
- `OC4` — `deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts` — the typed
  loader exists and its registry behavior is exercised.

## Edge Cases & Considerations

- **A refactor plan is exactly where placeholder completion hides.** `OC1`–`OC3` are shaped to fail on a rename plus
  re-export: the old directory must be absent and the old readers must stop owning path resolution.
- The current validation prompt helper is TypeScript, but it uses broad parsing shapes. The new module should keep the
  unavoidable front-matter parsing boundary small, name its shapes, and avoid spreading loose types into callers.
- `AGENTS.REVIEWER`, `AGENTS.REVIEWER_FEEDBACK_ENGINEER`, `AGENTS.SLICER`, `AGENTS.INIT`, `AGENTS.DELEGATED`, and
  `AGENTS.OPERATOR` are load-bearing runtime identifiers. Subagent registry keys may point to those names, but the
  `AGENTS` string values must not change or historical lifecycle records, Work Records, and metrics can stop joining.
- Init's loader is deliberately keyed to runtime `init` rather than the file basename (`init-agent-prompt`). Preserve
  that mapping in the registry rather than silently renaming the agent identifier.
- Manual QA is a workflow-dispatched prompt whose runtime `agentName` remains `operator`; the registry must not make it
  appear as a normal selectable Operator replacement.
- The Plan Server runtime intentionally copies only selected passive assets, not hidden subagent prompts. Moving the
  prompt directory under `src/agent-definitions/` must preserve that exclusion for Plan Server images while compiled
  local binaries still include the directory through the existing `src/agent-definitions/` include.
