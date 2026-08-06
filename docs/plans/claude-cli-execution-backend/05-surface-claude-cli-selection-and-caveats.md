---
planId: "e2827894-d88a-4cde-b289-39b89fdf08b0"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expose Claude CLI aliases and setup guidance through the TUI model-selection client, disclose the active Execution Backend and MVP transcript caveat in Workspace Session detail, and align Core documentation with established RunWield Connect terminology."
affectedPaths:
    - "src/ui/tui/model-selector.ts"
    - "src/ui/tui/model-selector.test.ts"
    - "src/ui/tui/model-welcome.ts"
    - "src/ui/tui/model-welcome.test.ts"
    - "src/ui/tui/ui-api-overrides.ts"
    - "src/ui/tui/ui-api-overrides.test.ts"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/workspace-session-backend-disclosure.test.ts"
    - "docs/prd/runwield-core-prd.md"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; grep -q \"getSelectable\" src/ui/tui/model-selector.ts; out=$(deno run -A scripts/run-tests.js --filter \"^TUI model selector exposes Pi and Claude CLI models without API auth$\" src/ui/tui/model-selector.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "Fails because the RunWield selector does not exist; passing requires the selector to consume selectable backend descriptors and its mixed Pi/Claude behavior test to pass."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; grep -q \"Claude Code.*file/Bash/tool\" src/ui/workspace/islands/SessionSurface.jsx; out=$(deno run -A scripts/run-tests.js --filter \"^Workspace Session disclosure distinguishes Claude CLI from Pi$\" src/ui/workspace/workspace-session-backend-disclosure.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "Fails because Workspace has neither the disclosure nor its test; passing proves Claude, Pi, and absent-model committed snapshots produce distinct read-only presentation."
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; grep -q \"Claude CLI\" docs/prd/runwield-core-prd.md; grep -q \"internal file/Bash/tool\" docs/prd/runwield-core-prd.md; grep -q \"External Agent Host\" docs/prd/runwield-core-prd.md; deno task doc-links:check'"
      rationale: "The Core PRD currently lacks Claude backend/caveat language; passing requires the durable Core-versus-Connect distinction and valid documentation links."
objectiveChecksBaseline:
    recordedAt: "2026-08-06T01:46:05.141Z"
    head: "bca1ec866721a7d07540546c8e9213ba49bbfca9"
    results:
        - id: "OC1"
          command: "bash -lc 'set -euo pipefail; grep -q \"getSelectable\" src/ui/tui/model-selector.ts; out=$(deno run -A scripts/run-tests.js --filter \"^TUI model selector exposes Pi and Claude CLI models without API auth$\" src/ui/tui/model-selector.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
          rationale: "Fails because the RunWield selector does not exist; passing requires the selector to consume selectable backend descriptors and its mixed Pi/Claude behavior test to pass."
          status: "unmet"
          stdout: ""
          stderr: "grep: src/ui/tui/model-selector.ts: No such file or directory\n"
          exitCode: 2
          durationMs: 35
          output: "\ngrep: src/ui/tui/model-selector.ts: No such file or directory\n"
        - id: "OC2"
          command: "bash -lc 'set -euo pipefail; grep -q \"Claude Code.*file/Bash/tool\" src/ui/workspace/islands/SessionSurface.jsx; out=$(deno run -A scripts/run-tests.js --filter \"^Workspace Session disclosure distinguishes Claude CLI from Pi$\" src/ui/workspace/workspace-session-backend-disclosure.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
          rationale: "Fails because Workspace has neither the disclosure nor its test; passing proves Claude, Pi, and absent-model committed snapshots produce distinct read-only presentation."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 28
          output: "\n"
        - id: "OC3"
          command: "bash -lc 'set -euo pipefail; grep -q \"Claude CLI\" docs/prd/runwield-core-prd.md; grep -q \"internal file/Bash/tool\" docs/prd/runwield-core-prd.md; grep -q \"External Agent Host\" docs/prd/runwield-core-prd.md; deno task doc-links:check'"
          rationale: "The Core PRD currently lacks Claude backend/caveat language; passing requires the durable Core-versus-Connect distinction and valid documentation links."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 24
          output: "\n"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-03T14:20:03-04:00"
updatedAt: "2026-08-06T02:18:40.966Z"
status: "verified"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 5
dependencies:
    - "04-harden-claude-cli-backend-failures-and-continuations"
implementedAt: "2026-08-06T02:06:21.258Z"
verifiedAt: "2026-08-06T02:18:40.966Z"
userVerifiedAt: null
executionReport: "- Implemented RunWield-owned TUI model selector sourced from `RunWieldModelRegistry.getSelectable()`, showing Pi/API models plus Claude CLI aliases with search, current-model marker, refresh feedback, guidance, selection/cancel restoration, and runtime callback messaging.\n- Updated no-model onboarding so `Use Claude Code CLI` opens Claude alias selection without `/login`; selected `claude-cli/*` defaults are treated as executable backend choices.\n- Added Workspace read-only Session model/backend disclosure from committed `timeline.snapshot`, Claude-only transcript caveat, missing-model fallback, and responsive `--rw-*` styling.\n- Updated Core PRD to describe Pi and Claude CLI as Core Execution Backends, Claude Code CLI setup/sign-in, MVP internal file/Bash/tool transcript limitation, and RunWield Connect/External Agent Host distinction.\n- Tests changed: added 6 tests (`model-selector` 2, Workspace disclosure 2, UI override Claude callback 1, no-provider Claude onboarding 1); updated existing onboarding tests only to select subscription explicitly after adding the Claude-first choice; no tests were deleted.\n- Verification passed: targeted plan tests `deno run -A scripts/run-tests.js src/ui/tui/model-selector.test.ts src/ui/tui/ui-api-overrides.test.ts src/ui/tui/model-welcome.test.ts src/ui/workspace/workspace-session-backend-disclosure.test.ts` (22 passed); regression tests for Claude model registry/session selection and owner Workspace (11 passed); objective checks OC1/OC2/OC3 passed; `deno task lint`, `deno task check`, `deno task workspace:check`, and `deno task doc-links:check` passed.\n- Full `deno task ci` did not pass: `src/ui/tui/golden-scenarios/project-workflow.test.js` timed out waiting for `runtime:agent:planner` during `project-child-objective-check-unmet-stops` in the full parallel run; the same test file passed when rerun directly afterward, but the full CI failure remains unresolved.\n- Headed browser preflight: `deno task workspace:dev` started from this worktree on `http://127.0.0.1:5174` because `5173` was occupied by another app; agent-browser headed session `runwield-claude-cli-surface-64a211f9` opened Workspace.\n- Browser checks performed: desktop root Workspace and phone-width `/projects/fixture/sessions/claude-session`; exact Session disclosure states could not be verified because `workspace:dev` has no owner Session API fixture for Claude/Pi/missing-model timelines, so the Session route rendered `Session failed to load` instead of committed Session detail.\n- Browser diagnostics: console showed existing PlanBoard key warnings/errors on the root Workspace; specific Claude/Pi/missing-model disclosure visibility, wrapping, and no-console-error requirements remain unverified in a real browser due the missing fixture/API state."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "bb1e58cfc565d226f5fb7cef80f37a536cb0b1a2"
    targetBranch: "main"
    targetHeadBeforeMerge: "bca1ec866721a7d07540546c8e9213ba49bbfca9"
validationCiAttempts: 0
validationSemanticRounds: 1
---

# Surface Claude CLI Selection and Caveats

## Context

The preceding Epic children are verified: `claude-cli/{sonnet,opus,haiku,fable}` are registered as selectable model
references, Claude-backed turns execute through `claude -p`, workflow signals cross the authenticated MCP bridge, and
backend failures are recoverable. The remaining user-facing path is incomplete:

- the TUI `/model` client still delegates to Pi's `ModelSelectorComponent`, whose available snapshot contains only
  API-authenticated Pi models, so Claude CLI aliases are not visible;
- no-model onboarding offers only subscription or API-key setup and still calls a selected Claude model “deferred,” even
  though the backend now executes it;
- Workspace Session detail already receives committed `snapshot.model` and `snapshot.provider` values but displays only
  the active Agent, so users cannot tell which Execution Backend will handle continuation or see the MVP transcript
  limitation.

Model choice is not owned by either UI. Session Runtime and RunWield settings/model resolution remain authoritative; TUI
`/model` is one client of `reconfigureSessionModel`, and a future Workspace selector must call the same runtime
operation rather than write an independent settings state. Per the planning decision, this child keeps Workspace
read-only and adds disclosure only.

Claude CLI is a RunWield Core Execution Backend, not RunWield Connect. Core shells out to Claude Code from inside a
RunWield Session and retains Session Transcript/workflow authority. In Connect, Claude Code is the External Agent Host,
owns the user conversation, and makes every model call.

## Objective

Make Claude CLI aliases discoverable and selectable through TUI `/model`, let no-model onboarding choose Claude Code
without implying API-key authentication, and show the committed Session model/Execution Backend plus the MVP transcript
caveat in Workspace Session detail. Document the implemented backend in the Core PRD using the already-canonical
Execution Backend, Session Transcript, External Agent Host, and RunWield Connect language.

## Approach

Add a RunWield-owned TUI model selector that consumes `RunWieldModelRegistry.getSelectable()` so Pi-backed models and
Claude CLI descriptors share one searchable selection surface without registering Claude as a Pi provider. Preserve the
existing callback into `setActiveSessionModel` / `SessionRuntime.reconfigureSessionModel`; the selector owns display and
input only. Use backend metadata to label Claude choices and show concise install/sign-in guidance, while preserving
existing provider refresh, cancellation, focus restoration, and active-model behavior.

Update no-model onboarding with a Claude Code CLI route that does not invoke `/login`. A selected Claude model is
runnable by the implemented backend, so availability logic must no longer classify it as a deferred unsupported model;
actual missing executable/auth failures remain owned by the backend preflight/typed failure path from child 04.

In Workspace, derive a read-only disclosure from committed `timeline.snapshot.model` and `.provider`. Show the exact
model reference for every Session. When provider/backend is `claude-cli`, add a warning notice explaining that Claude
Code owns internal file/Bash/tool activity and RunWield persists final assistant/workflow history rather than native
RunWield tool events. Do not add a model mutation endpoint or settings page in this child.

Reuse the existing Session summary-card/notice visual language and `--rw-*` tokens. No new design-system primitive or
glossary term is expected: `CONTEXT.md` and the RunWield Connect PRD already carry the canonical distinction. Update
those files only if execution discovers an actual inconsistency, not to restate already-correct language.

## Files to Modify

- `src/ui/tui/model-selector.ts` — own the searchable RunWield model-selection UI over registry-selectable models,
  including backend labels/guidance, without making the UI a model-state authority.
- `src/ui/tui/model-selector.test.ts` — cover mixed Pi/Claude listing, filtering, selection, cancellation, and guidance.
- `src/ui/tui/model-welcome.ts` — offer Claude Code CLI setup without `/login` and treat selected Claude models as
  executable backend choices.
- `src/ui/tui/model-welcome.test.ts` — protect no-provider Claude onboarding, existing API login, cancellation, and root
  Session activation behavior.
- `src/ui/tui/ui-api-overrides.ts` — compose the RunWield selector with `setActiveModel`, focus restoration, and runtime
  model refresh/state.
- `src/ui/tui/ui-api-overrides.test.ts` — prove Claude and API selections reach the existing runtime callback and the
  editor is restored on success/cancel.
- `src/ui/workspace/islands/SessionSurface.jsx` — render committed model/backend metadata and the Claude-only transcript
  caveat in Session detail.
- `src/ui/workspace/static/workspace.css` — style the disclosure with existing Session card/notice patterns and semantic
  `--rw-*` tokens, including narrow viewport behavior.
- `src/ui/workspace/workspace-session-backend-disclosure.test.ts` — cover Claude disclosure, Pi model display without
  the caveat, and missing-model fallback from committed projection values.
- `docs/prd/runwield-core-prd.md` — document model-selected Execution Backends, Claude CLI ownership, setup, and the MVP
  Session Transcript limitation.

`docs/prd/attached-mode-prd.md`, `CONTEXT.md`, and `docs/design-system.md` are evidence to preserve, not expected edits:
they already define the Core/Connect distinction, Execution Backend term, and reusable notice/token patterns.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.ts` — consume `getSelectable()`, `RunWieldModel.executionBackend`, and
  provider/model display metadata; do not add Claude descriptors to Pi's runnable snapshot.
- `src/shared/session/model-selection.ts` — retain `setActiveSessionModel` and `SessionRuntime.reconfigureSessionModel`
  as the model-change authority.
- Pi TUI selector behavior — preserve searchable filtering, current-model indication, refresh feedback, keyboard
  navigation, and cancellation semantics where practical, while replacing its API-auth-only data source.
- `src/shared/session/session-transcript-projection.js` — consume the existing committed snapshot `{ model, provider }`;
  do not create a second Workspace projection or infer from display events.
- `src/ui/workspace/islands/SessionSurface.jsx` and `src/ui/workspace/static/workspace.css` — reuse Session
  summary-card, status, and responsive patterns.
- `src/ui/design-system/tokens.css` / `components.css` — use semantic warning, border, surface, and text tokens; no
  hard-coded Claude brand colors.
- `docs/prd/attached-mode-prd.md` and `CONTEXT.md` — preserve their canonical Core Execution Backend versus Connect
  External Agent Host distinction.

## Implementation Steps

- [ ] `src/ui/tui/model-selector.ts` renders one searchable list sourced from `RunWieldModelRegistry.getSelectable()`:
      configured Pi/API models and the four advertised Claude aliases are selectable, Claude entries are visibly
      identified as `Claude CLI`, and no Claude descriptor is inserted into `ModelRuntime.getAvailableSnapshot()` or
      API-auth flows.
- [ ] Selecting any item calls the existing `setActiveModel(model.id, model.provider)` callback exactly once; successful
      active/deferred result messaging is shown accurately, cancellation changes neither runtime nor defaults, and the
      editor/focus is restored on every settle/error path.
- [ ] TUI model-selection behavior retains fuzzy search, keyboard navigation, current-model indication, model-catalog
      refresh/error feedback for Pi providers, and the existing configured-provider guidance while adding concise Claude
      install/sign-in guidance.
- [ ] No-model onboarding offers `Use Claude Code CLI` independently of subscription/API-key login, opens the selector
      on the Claude choices, and can activate a Claude-backed root Session without calling `/login`; existing
      subscription/API-key onboarding remains unchanged.
- [ ] `getSelectedDefaultModelAvailability` recognizes a registry-selectable `claude-cli/*` model as executable by the
      installed RunWield backend; missing executable/auth remains a typed first-turn backend failure with the child-04
      recovery language rather than an API credential prompt.
- [ ] Workspace Session detail always shows the committed model reference from `timeline.snapshot`; for
      `provider === "claude-cli"` it also labels the Execution Backend and states that Claude Code's internal
      file/Bash/tool activity is not native RunWield tool-event history, while RunWield owns Session Transcript,
      workflow, resume, and replay.
- [ ] Pi-backed Workspace Sessions show their model without the Claude caveat, and Sessions whose committed projection
      has no model render an honest `Model not recorded` fallback rather than inferring from current settings or live UI
      state.
- [ ] Workspace disclosure is read-only: this child adds no browser model mutation route, settings write, or alternative
      model owner. Styling uses existing `--rw-*` semantics and remains readable at desktop and phone widths.
- [ ] `docs/prd/runwield-core-prd.md` describes Pi and Claude CLI as model-selected Core Execution Backends, gives
      Claude install/sign-in guidance, records the MVP transcript limitation, and points readers to the
      already-documented Connect distinction without calling Claude CLI Attached Mode.
- [ ] `CONTEXT.md`, `docs/prd/attached-mode-prd.md`, and `docs/design-system.md` remain unchanged unless implementation
      finds a factual inconsistency or needs a genuinely reusable new visual pattern; any such edit must preserve
      implemented current-state language.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/ui/tui/model-selector.test.ts src/ui/tui/ui-api-overrides.test.ts src/ui/tui/model-welcome.test.ts src/ui/workspace/workspace-session-backend-disclosure.test.ts`.
- Automated regression:
  `deno run -A scripts/run-tests.js src/shared/models/claude-cli-models.test.ts src/shared/session/claude-cli-model-selection.test.ts src/ui/workspace/owner-workspace.test.js`.
- Automated static/type/docs: `deno task workspace:check && deno task check && deno task doc-links:check`.
- Headed browser (mandatory): run `deno task workspace:dev`, open `http://127.0.0.1:5173`, navigate through Projects →
  Sessions → a Claude-backed Session detail fixture/state, and verify the exact `claude-cli/<selector>` reference,
  `Claude CLI` Execution Backend label, and transcript caveat are visible without scrolling past the Session summary on
  a desktop viewport.
- Headed browser (mandatory): repeat the Session detail check at a phone-width viewport; the model metadata and warning
  must wrap without clipping or horizontal scrolling, remain legible, and not obscure activation status, timeline, or
  continuation controls.
- Headed browser (mandatory): inspect a Pi-backed Session and a missing-model fixture/state; Pi shows model metadata
  without the Claude warning, while missing-model shows `Model not recorded` without broken/empty badges. Confirm the
  browser console has no errors in all three states.
- Manual TUI: open `/model` with configured Pi auth and verify API models plus all four Claude aliases can be searched;
  select `claude-cli/sonnet` and confirm the runtime model changes through the existing callback, then cancel a second
  selection and confirm the active model does not change.
- Manual onboarding: under a clean sandboxed HOME with no API provider, choose `Use Claude Code CLI`, select an alias,
  and confirm RunWield does not ask for an API key or subscription login. A missing/unauthenticated `claude` should use
  the child-04 first-turn failure guidance.
- Expected: Core PRD, existing Connect PRD, and `CONTEXT.md` consistently distinguish a Core Execution Backend from an
  External Agent Host and do not claim native RunWield events for Claude's internal tools.
- Behavior protected afterwards: Pi-backed provider refresh/search/selection and onboarding login paths; runtime-owned
  model mutation; Workspace Session activation, timeline, and continuation behavior; committed projection as Workspace
  truth.
- Behavior expected to stop existing: Claude aliases being absent from `/model`; onboarding treating Claude CLI like an
  API-auth provider or unsupported deferred backend; Workspace hiding the selected Session model/backend.
- Confirm the glossary continues to describe implemented behavior and no PRD edit promotes an unimplemented Workspace
  model selector.

### Objective-Failing Checks

- `OC1` —
  `bash -lc 'set -euo pipefail; grep -q "getSelectable" src/ui/tui/model-selector.ts; out=$(deno run -A scripts/run-tests.js --filter "^TUI model selector exposes Pi and Claude CLI models without API auth$" src/ui/tui/model-selector.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — fails because the RunWield selector does not exist; passes only when the UI consumes selectable backend descriptors
  and the focused behavior test succeeds.
- `OC2` —
  `bash -lc 'set -euo pipefail; grep -q "Claude Code.*file/Bash/tool" src/ui/workspace/islands/SessionSurface.jsx; out=$(deno run -A scripts/run-tests.js --filter "^Workspace Session disclosure distinguishes Claude CLI from Pi$" src/ui/workspace/workspace-session-backend-disclosure.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — fails because Workspace has neither the disclosure nor its test; proves Claude, Pi, and absent-model committed
  snapshots produce distinct read-only presentation.
- `OC3` —
  `bash -lc 'set -euo pipefail; grep -q "Claude CLI" docs/prd/runwield-core-prd.md; grep -q "internal file/Bash/tool" docs/prd/runwield-core-prd.md; grep -q "External Agent Host" docs/prd/runwield-core-prd.md; deno task doc-links:check'`
  — the Core PRD currently contains none of the Claude backend/caveat language; passing requires the durable product
  distinction and valid documentation links.

## Edge Cases & Considerations

- **Authority:** TUI and Workspace are clients. Neither may mutate model state except through Session Runtime's existing
  model operation; committed Session projection remains Workspace display truth.
- **Workspace scope:** read-only disclosure is the explicit product decision for this child. Do not add a settings page,
  preset editor, or owner API mutation as an “easy” extension.
- **Selection semantics:** model selection determines the Execution Backend. Do not add an independent backend toggle
  that can disagree with the selected model metadata.
- **Pi boundary:** Claude descriptors must remain outside Pi `ModelRuntime` runnable/auth snapshots; UI composition must
  not make Claude look API-authenticated merely to reuse Pi's selector.
- **Health timing:** selection can explain install/sign-in prerequisites, but the execution backend remains responsible
  for deterministic executable/auth checks and sanitized errors. The UI must not run a second ad hoc health authority.
- **Current versus future Session:** if runtime reconfiguration returns `deferred`, display its exact consequence; never
  claim the current Session switched. When it returns `active`, do not retain the old child-01 deferred wording.
- **Transcript wording:** Claude internal file/Bash/tool activity may affect the worktree but is not projected as native
  RunWield tool events in MVP. RunWield still owns ordinary assistant messages, workflow signals/state, resume, and
  replay.
- **Images:** advertised Claude descriptors remain text-input models in current registry metadata. Preserve existing
  vision-fallback/blocking behavior and do not imply Claude CLI image parity in copy.
- **Visual identity:** use RunWield semantic tokens and existing notice/card patterns, not Claude brand colors or a
  separate Claude settings experience.
- **Documentation:** use RunWield Connect in customer-facing wording and Attached Mode only for the internal
  architecture. Do not edit already-correct PRD/glossary text merely to create churn.
- **Working tree:** the pre-existing `docs/releasing.md` modification is unrelated and must not be changed by execution.
