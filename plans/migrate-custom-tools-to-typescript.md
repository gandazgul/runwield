---
planId: "737f3714-627e-4fd4-a69e-99d1e9b863dd"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Migrate the eight remaining direct RunWield Custom Tool implementations from JavaScript/JSDoc to Deno-native TypeScript without changing their schemas, workflow outcomes, or runtime behavior."
affectedPaths:
    - "src/tools/task-completed.ts"
    - "src/tools/review-complete.ts"
    - "src/tools/triage-report.ts"
    - "src/tools/user-interview.ts"
    - "src/tools/delegate-agent.ts"
    - "src/tools/pair-checkpoint.ts"
    - "src/tools/see-image.ts"
    - "src/tools/multi_file_edit.ts"
    - "src/shared/session/session.js"
    - "src/shared/workflow/validation-helpers.ts"
    - "scripts/language-policy-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -e; specs=\"delegate-agent:createDelegateAgentTool multi_file_edit:createMultiFileEditTool pair-checkpoint:createPairCheckpointTool review-complete:createReviewCompletedTool see-image:createSeeImageTool task-completed:createTaskCompletedTool triage-report:createTriageReportTool user-interview:createUserInterviewTool\"; for s in $specs; do n=${s%%:*}; f=${s#*:}; p=src/tools/$n.ts; test -s \"$p\"; test ! -e \"src/tools/$n.js\"; grep -Eq \"^export function $f\\\\(\" \"$p\"; grep -q \"defineTool<\" \"$p\"; ! grep -Eq \"export[[:space:]]+\\\\*|@ts-(ignore|nocheck)\" \"$p\"; done; test -z \"$(find src/tools -maxdepth 1 -type f -name \"*.js\" ! -name \"*.test.js\" ! -name docs-file-tools.js ! -name edit-with-fallback.js ! -name grep.js ! -name read.js ! -name registry.js -print)\"'"
      rationale: "Fails while any migrated JavaScript implementation exists and rejects empty files, re-export shims, suppression directives, missing owned factories, missing typed defineTool calls, or renamed legacy JavaScript beside the tools."
    - id: "OC2"
      command: "bash -lc 'set -e; for n in delegate-agent multi_file_edit pair-checkpoint review-complete see-image task-completed triage-report user-interview; do test -s src/tools/$n.ts; test ! -e src/tools/$n.js; done; deno task check; deno task language-policy:check; deno run -A scripts/run-tests.js -A src/tools/__tests__/delegate-agent.test.js src/tools/__tests__/multi-file-edit.test.js src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/review-complete.test.js src/tools/see-image.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js'"
      rationale: "Fails on the current missing TypeScript modules and requires all eight replacements to compile, satisfy language policy, and pass every direct Custom Tool behavior suite after the JavaScript implementations are gone."
objectiveChecksBaseline:
    recordedAt: "2026-08-03T18:36:38.047Z"
    head: "7bc0aa3482c7dc1623e21c7e26b6a6f627f7f6d2"
    results:
        - id: "OC1"
          command: "bash -lc 'set -e; specs=\"delegate-agent:createDelegateAgentTool multi_file_edit:createMultiFileEditTool pair-checkpoint:createPairCheckpointTool review-complete:createReviewCompletedTool see-image:createSeeImageTool task-completed:createTaskCompletedTool triage-report:createTriageReportTool user-interview:createUserInterviewTool\"; for s in $specs; do n=${s%%:*}; f=${s#*:}; p=src/tools/$n.ts; test -s \"$p\"; test ! -e \"src/tools/$n.js\"; grep -Eq \"^export function $f\\\\(\" \"$p\"; grep -q \"defineTool<\" \"$p\"; ! grep -Eq \"export[[:space:]]+\\\\*|@ts-(ignore|nocheck)\" \"$p\"; done; test -z \"$(find src/tools -maxdepth 1 -type f -name \"*.js\" ! -name \"*.test.js\" ! -name docs-file-tools.js ! -name edit-with-fallback.js ! -name grep.js ! -name read.js ! -name registry.js -print)\"'"
          rationale: "Fails while any migrated JavaScript implementation exists and rejects empty files, re-export shims, suppression directives, missing owned factories, missing typed defineTool calls, or renamed legacy JavaScript beside the tools."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 36
          output: "\n"
        - id: "OC2"
          command: "bash -lc 'set -e; for n in delegate-agent multi_file_edit pair-checkpoint review-complete see-image task-completed triage-report user-interview; do test -s src/tools/$n.ts; test ! -e src/tools/$n.js; done; deno task check; deno task language-policy:check; deno run -A scripts/run-tests.js -A src/tools/__tests__/delegate-agent.test.js src/tools/__tests__/multi-file-edit.test.js src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/review-complete.test.js src/tools/see-image.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js'"
          rationale: "Fails on the current missing TypeScript modules and requires all eight replacements to compile, satisfy language policy, and pass every direct Custom Tool behavior suite after the JavaScript implementations are gone."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 17
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T14:17:36-04:00"
updatedAt: "2026-08-03T21:07:07.043Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-03T18:54:18.626Z"
verifiedAt: "2026-08-03T21:07:07.043Z"
userVerifiedAt: null
executionReport: "- Migrated the eight direct Custom Tool implementations to non-empty `.ts` modules and removed their `.js` implementations: `delegate-agent`, `multi_file_edit`, `pair-checkpoint`, `review-complete`, `see-image`, `task-completed`, `triage-report`, and `user-interview`.\n- Updated live imports/type references and `scripts/language-policy-baseline.json`; remaining `.js` references are historical `src/plan-store.test.js` fixture strings only.\n- Preserved focused behavior coverage; no tests were deleted or replaced, only import specifiers were updated.\n- Verification passed: OC1 shape check; `deno task check`; `deno task language-policy:check`; OC2 direct tool suite (`84 passed`); focused suite excluding the plan-listed missing `src/shared/workflow/agent-runners.integration.test.ts` (`118 passed`).\n- Verification failed: `deno task seams:check` and therefore `deno task ci` fail on existing injection-seam regressions in `engineer-runner.ts`, `epic-continuation.ts`, `execution-start.ts`, `plan-executor.ts`, and `planning-agent.ts`; `deno task seams:update` also refused to loosen the baseline."
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-03T20:43:18.443Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "750cfb537b93e5d95434642e630f1c5ff0a8b743"
    targetBranch: "main"
    targetHeadBeforeMerge: "2495b6ce77252834108f9f0e1cfd8faf94e5ed4f"
routingIntent: "PLANNED_CHANGE"
sessionName: "custom tools TypeScript"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Migrate Direct Custom Tools to TypeScript

## Context

`task_completed` and `review_complete` are two of eight direct RunWield Custom Tools that still implement their own
TypeBox schema and `defineTool()` execution in JavaScript with JSDoc. The other six are `triage_report`,
`user_interview`, `delegate_agent`, `pair_checkpoint`, `see_image`, and `multi_file_edit`. Peer Custom Tools such as
`plan_written`, `return_to_router`, and the Work Record tools already demonstrate the repository's Deno-native
TypeScript pattern.

This is a behavior-preserving language migration. It must retain the Custom Tools' current public exports, schema
validation, Hosted Session interactions, workflow messages and metrics, terminal/non-terminal outcomes, rollback and
cancellation behavior, and tool result details. Built-in-derived adapters (`read`, `grep`, edit fallback, and Markdown
file tools) and `src/tools/registry.js` are explicitly outside this Plan.

The current primary working tree has uncommitted changes in files that overlap this migration, including
`src/tools/delegate-agent.js`, `src/shared/session/session.js`, `src/shared/workflow/engineer-runner.ts`, and
`scripts/language-policy-baseline.json`. Those intended changes must be committed/landed before this Plan executes; the
landed versions are the source of truth and this migration must not restore seams or behavior removed by that work.

## Objective

Replace the eight direct JavaScript Custom Tool modules with native `.ts` modules that expose precise named parameter,
option, details, and helper types; compile under the repository's no-`any`/no-`unknown`/no-bare-`object` TypeScript
policy; and remain behaviorally interchangeable for every current caller and test. All live imports and type references
must use the real `.ts` extensions, and the language-policy baseline must shrink by the eight removed JavaScript paths.

## Approach

Rename each implementation rather than adding compatibility shims. Use the established TypeScript Custom Tool pattern:
keep TypeBox schemas as runtime authority, let `defineTool<typeof PARAMETERS, Details>` infer validated parameters, use
named interfaces/unions for options and result details, and give tool execution paths explicit `AgentToolResult`
contracts where success and error shapes vary. Export types already consumed across module boundaries, notably
`ReviewFinding`, `ReviewAdvisory`, and `InterviewResultDetails`.

Preserve existing capability boundaries. `HostedSession` remains the owner of workflow state and interactions;
`requestHostedSessionInteraction`, workflow message emitters, metrics, Plan locks, Git fixtures, and isolated agent
execution continue through their current interfaces. Do not add dependency bags, conditional seams, aliases, `.js`
re-export shims, `@ts-ignore`/`@ts-nocheck`, or transpilation output.

## Files to Modify

- `src/tools/task-completed.js` → `src/tools/task-completed.ts` — type the agent-dependent parameter schema, options,
  rejection reasons, accepted completion details, and frontend execution metric fields while preserving terminal
  completion semantics.
- `src/tools/review-complete.js` → `src/tools/review-complete.ts` — export typed findings/advisories, normalize schema
  input into precise structures, and preserve fail-closed approval and structured projection behavior.
- `src/tools/triage-report.js` → `src/tools/triage-report.ts` — type canonical Routing Intent/Work Kind normalization,
  normalized report details, Hosted Session option, metrics, and terminal result.
- `src/tools/user-interview.js` → `src/tools/user-interview.ts` — replace JSDoc question/result unions and broad casts
  with exported discriminated unions and typed interaction-response handling across completed, canceled, invalid, and
  validation-error outcomes.
- `src/tools/delegate-agent.js` → `src/tools/delegate-agent.ts` — type delegation modes/roles, landed dependency
  options, Git snapshots, isolated-session results, lease lifetime, and success/failure details without weakening the
  role authority ceiling or change-attribution checks.
- `src/tools/pair-checkpoint.js` → `src/tools/pair-checkpoint.ts` — type checkpoint parameters/details and every Pair
  Execution state transition, including cancellation, capability loss, revision feedback, stop, and autonomous fallback.
- `src/tools/see-image.js` → `src/tools/see-image.ts` — use concrete Pi model, session manager, model-registry auth,
  completion content, parameters, and result types while retaining safe image resolution and error reporting.
- `src/tools/multi_file_edit.js` → `src/tools/multi_file_edit.ts` — type edits, prepared arguments, grouped operations,
  snapshots, diffs, Plan revision writes, nested locks, success details, and rollback errors without changing atomicity.
- `src/shared/session/session.js` — update static and dynamic Custom Tool imports to the real `.ts` module extensions;
  do not otherwise expand the high-authority Session composition scope.
- `src/shared/workflow/validation-helpers.ts`, `src/shared/workflow/review-ledger.ts`, and
  `src/shared/workflow/engineer-runner.ts` — update pair-checkpoint/review type imports to `.ts` and consume the
  exported native TypeScript types without duplicate local shapes.
- `src/shared/workflow/workflow-results.js` — point JSDoc review outcome references at `review-complete.ts` while
  preserving its JavaScript public contract.
- `src/shared/session/task-completion-session.test.ts`, `src/shared/session/agent-handler.test.ts`,
  `src/shared/workflow/validation-completion-gating.test.ts`, and
  `src/shared/workflow/implementation-checkpoint-completion.test.ts` — update direct task-completion imports and retain
  cross-module completion gating coverage.
- `src/tools/__tests__/delegate-agent.test.js`, `src/tools/__tests__/multi-file-edit.test.js`,
  `src/tools/__tests__/pair-checkpoint.test.js`, `src/tools/__tests__/review-complete.test.js`,
  `src/tools/__tests__/task-completed.test.js`, `src/tools/__tests__/triage-report.test.js`,
  `src/tools/__tests__/user-interview.test.js`, `src/tools/__tests__/user-interview-combinations.test.js`, and
  `src/tools/see-image.test.js` — import the `.ts` implementations and keep the existing behavioral assertions intact;
  add focused assertions only where a newly explicit result union exposes an unprotected existing branch.
- `scripts/language-policy-baseline.json` — remove exactly the eight retired JavaScript implementation paths and retain
  all out-of-scope adapter/registry entries.

## Reuse Opportunities

- `src/tools/work-record-search.ts` and `src/tools/work-record-read.ts` — reuse the
  `defineTool<typeof PARAMETERS, Details>` and explicit `AgentToolResult` typing pattern.
- `src/tools/plan-written.ts` — reuse named option/result interfaces and `HostedSession` type-only imports for a
  stateful terminal Custom Tool.
- `src/shared/session/hosted-session.js` — import the existing `HostedSession` and `ActiveExecutionWorkflow` types;
  workflow state remains authoritative here.
- `src/shared/session/session-runtime-interactions.js` — reuse the existing request/response contracts and outcome
  constants for user interviews and Pair Checkpoints.
- Existing focused Custom Tool tests and real filesystem/Git/Hosted Session fixtures — preserve behavior through real
  composition rather than adding test-only product seams.

## Implementation Steps

- [ ] The execution baseline includes the previously uncommitted overlapping work, and the migration types the landed
      `delegate_agent`, Session wiring, Pair Checkpoint runner, and language baseline rather than restoring superseded
      code or dependency seams.
- [ ] The eight direct implementations exist only as non-empty `.ts` modules, retain their current exported factory and
      helper names, and contain no `.js` compatibility modules, `@ts-ignore`, `@ts-nocheck`, explicit `any`, explicit
      `unknown`, or bare `object` types.
- [ ] Every migrated factory uses its runtime TypeBox schema with typed `defineTool` parameters and named option/detail
      contracts; all success, rejection, cancellation, and error returns satisfy explicit result shapes without broad
      casts.
- [ ] `task_completed`, `review_complete`, and `triage_report` preserve current workflow ownership checks, structured
      details, message/metric emission, fail-closed rejection paths, and terminal behavior; rejected completion/review
      calls remain non-terminal.
- [ ] `user_interview` and `pair_checkpoint` preserve all interaction outcomes and state invariants: cancellation pauses
      safely, unsupported/blocked Pair Checkpoints fall back to autonomous work without implying approval, revision
      requires feedback, and ordered interview answers retain IDs, labels, Other text, and error positions.
- [ ] `delegate_agent` preserves role authority ceilings, read/write lease behavior, tool filtering, model/thinking
      overrides, isolated transcript output, Git snapshot attribution, abort/error handling, and release in `finally`;
      no landed seam is reintroduced.
- [ ] `see_image` still accepts only resolved safe image references, authenticates and calls the configured Vision
      Fallback with image content, extracts assistant text, propagates aborts, and returns typed error details without
      exposing a broad model/completion type.
- [ ] `multi_file_edit` preserves original-content matching, overlap rejection, line endings and byte-order marks, Plan
      catalog/Plan lock ordering, revision-checked Plan writes, serialized non-Plan writes, reverse rollback, and
      diff/first-line details.
- [ ] All live source imports and JSDoc/type references use the eight `.ts` paths. Historical Plan text and the
      `src/plan-store.test.js` affected-path fixture strings remain unchanged because they are data, not module imports.
- [ ] `scripts/language-policy-baseline.json` no longer lists the eight migrated `.js` paths, still lists every
      out-of-scope JavaScript tool adapter/registry path, and passes the stale-entry/new-JavaScript guard.
- [ ] Existing focused and integration tests continue to protect the behaviors named above; no test is deleted merely
      because its old `.js` import no longer resolves. No Custom Tool behavior is expected to stop existing.

## Verification Plan

- Automated TypeScript/policy checks:
  - `deno task check`
  - `deno task language-policy:check`
  - `deno task seams:check`
- Automated focused behavior:
  - `deno run -A scripts/run-tests.js -A src/tools/__tests__/delegate-agent.test.js src/tools/__tests__/multi-file-edit.test.js src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/review-complete.test.js src/tools/see-image.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/agent-handler.test.ts src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/implementation-checkpoint-completion.test.ts src/shared/workflow/agent-runners.integration.test.ts`
- Full regression gate: `deno task ci`
- Manual: none required; this is an internal behavior-preserving migration with no user-visible workflow change.
- Expected results: each Custom Tool remains registered under the same name and schema; completion/review/triage
  terminal signals are unchanged; interactive tools retain cancellation and fallback behavior; delegation retains
  authority and attribution safeguards; image and multi-file failures remain typed tool errors; all eight baseline
  entries disappear.
- Protected behavior: all behavior named in the Implementation Steps must remain covered. No existing behavior or test
  scenario is intentionally retired.

### Objective-Failing Checks

- `OC1` —
  `bash -lc 'set -e; specs="delegate-agent:createDelegateAgentTool multi_file_edit:createMultiFileEditTool pair-checkpoint:createPairCheckpointTool review-complete:createReviewCompletedTool see-image:createSeeImageTool task-completed:createTaskCompletedTool triage-report:createTriageReportTool user-interview:createUserInterviewTool"; for s in $specs; do n=${s%%:*}; f=${s#*:}; p=src/tools/$n.ts; test -s "$p"; test ! -e "src/tools/$n.js"; grep -Eq "^export function $f\\(" "$p"; grep -q "defineTool<" "$p"; ! grep -Eq "export[[:space:]]+\\*|@ts-(ignore|nocheck)" "$p"; done; test -z "$(find src/tools -maxdepth 1 -type f -name "*.js" ! -name "*.test.js" ! -name docs-file-tools.js ! -name edit-with-fallback.js ! -name grep.js ! -name read.js ! -name registry.js -print)"'`
  — fails while any migrated JavaScript implementation exists and rejects empty files, re-export shims, suppression
  directives, missing owned factories, missing typed `defineTool` calls, or renamed legacy JavaScript beside the tools.
- `OC2` —
  `bash -lc 'set -e; for n in delegate-agent multi_file_edit pair-checkpoint review-complete see-image task-completed triage-report user-interview; do test -s src/tools/$n.ts; test ! -e src/tools/$n.js; done; deno task check; deno task language-policy:check; deno run -A scripts/run-tests.js -A src/tools/__tests__/delegate-agent.test.js src/tools/__tests__/multi-file-edit.test.js src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/review-complete.test.js src/tools/see-image.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js'`
  — fails on the current missing `.ts` modules and requires the migrated modules to compile and satisfy every direct
  Custom Tool behavior suite after their `.js` implementations are gone.

## Execution Policy

- Engineer executes autonomously; no browser or dev server is involved.
- Do not start execution until the overlapping primary-tree changes identified in Context have landed on the execution
  base. If they are intentionally abandoned instead, return this Plan for review against the new baseline rather than
  silently reconstructing their old contents.

## Edge Cases & Considerations

- The eight files total roughly 2,500 lines; mechanical renaming without explicit result contracts can conceal invalid
  branches. Type each tool by capability and outcome rather than centralizing unrelated tool types into a shallow shared
  module.
- Runtime TypeBox schemas remain the external tool interface and source of input validation truth. Native TypeScript
  types must describe that interface, not create a competing schema or change optional/default fields.
- JavaScript callers may import TypeScript directly under Deno using real `.ts` extensions; migrating the large
  `src/shared/session/session.js` composition module is intentionally out of scope.
- Current JavaScript tests may remain JavaScript when only their import specifier changes. Converting test suites or
  high-authority callers is not required to prove these eight production implementations migrated.
- `ReviewFinding`, `ReviewAdvisory`, and `InterviewResultDetails` are cross-module contracts. Preserve their existing
  field optionality and exported names so TypeScript and JSDoc consumers stay compatible.
- The injection-seam baseline must not increase. If prerequisite work removed seams, preserve that tighter baseline; do
  not use `seams:update` to re-allow one.
- No `CONTEXT.md` update is needed because Custom Tool names, ownership, and behavior do not change.
