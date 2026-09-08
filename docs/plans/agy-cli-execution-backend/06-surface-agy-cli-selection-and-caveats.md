---
planId: "3f664125-84bc-4f9a-8c13-eb98d2240f28"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/models/model-registry.ts"
    - "src/shared/session/backends/agy-cli/"
    - "src/shared/session/session-transcript-projection.js"
    - "src/cmd/models/"
    - "src/ui/tui/model-selector.ts"
    - "src/ui/tui/model-setup.ts"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/server/dev-owner-fixtures.ts"
    - "docs/prd/runwield.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-23T20:02:05.487Z"
status: "validated"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 6
dependencies:
    - "05-harden-agy-cli-failures-and-continuations"
userVerifiedAt: null
targetBranch: "feature/agy-cli-execution-backend"
---

# Surface Agy CLI Selection and Caveats

## Context

Children 03 through 05 make `agy-cli` executable, connect its workflow tools through Model Context Protocol (MCP), and
make failures safe to replay. The integration branch still treats every non-empty `agy-cli/<id>` as a direct reference
and does not put Antigravity in normal model pickers. Users also cannot see the committed Execution Backend in the
Workspace Session sidebar.

The user chose the same picker model used by Claude CLI, not free-form Antigravity references. RunWield will initially
support only Antigravity's current Gemini 3.8 Flash and Gemini 3.1 Pro base-model slugs. Antigravity 1.1.27 proves that
these base models require a separate effort value. RunWield maps its existing thinking levels to Agy's smaller effort
sets:

| RunWield thinking       | Flash 3.8 effort/result              | Pro 3.1 effort/result          |
| ----------------------- | ------------------------------------ | ------------------------------ |
| `off`, `minimal`, `low` | `low` / `gemini-3.8-flash-low`       | `low` / `gemini-3.1-pro-low`   |
| `medium`                | `medium` / `gemini-3.8-flash-medium` | `high` / `gemini-3.1-pro-high` |
| `high`, `xhigh`, `max`  | `high` / `gemini-3.8-flash-high`     | `high` / `gemini-3.1-pro-high` |

Model and thinking choice remain owned by Session Runtime. TUI and Workspace controls are clients of that owner. The
Workspace Session tab shows committed facts; staged composer choices must not appear there before they commit.

## Objective

Expose exactly two supported Antigravity model families in the established TUI and Workspace model pickers. Map every
RunWield thinking level to the nearest supported Agy effort, then run Agy with the selected base model plus `--effort`.
Reject unsupported Agy model IDs before any Agy process or global-file side effect.

Show the committed `provider/model`, thinking level, and Execution Backend in the Workspace Session sidebar. For Agy
Sessions, explain that RunWield replay does not contain Antigravity's native file, shell, or internal tool activity.
Update Core product requirements without describing this Execution Backend as RunWield Connect.

## Approach

Make the model registry the source of truth for the two picker entries. Keep RunWield's normal thinking controls and
settings unchanged. The Agy backend owns one closed mapping from every RunWield thinking level to the selected base
model's supported effort:

```text
                    Flash 3.8   Pro 3.1
off|minimal|low ->  low         low
medium          ->  medium      high
high|xhigh|max  ->  high        high
```

This mapping applies after normal invocation, Agent, Project, model-preset, and Agent Definition precedence resolves the
RunWield thinking level. It therefore covers picker changes and saved settings without adding a second UI rule or
rejecting a valid RunWield level. Existing Pi and Claude CLI behavior stays unchanged.

For an Agy turn, preserve the selected base model and original RunWield thinking as user-facing Session state, map the
thinking level, and pass the base model with the mapped Agy effort:

```text
Session model: agy-cli/gemini-3.1-pro
RunWield thinking: medium
  -> map medium to Agy high
  -> agy ... --model gemini-3.1-pro --effort high
  -> verified backend model: gemini-3.1-pro-high
```

The Agy backend validates returned model metadata against the resolved concrete model. Its committed
`runwield.execution_backend` entry records both the selected base model and concrete backend model. Transcript
projection then supplies the latest committed Execution Backend to Workspace; it does not infer this fact from a staged
picker or provider-name prefix.

In the existing Workspace **Session** sidebar tab, use the current definition-list and muted-notice patterns:

```text
Model: agy-cli/gemini-3.8-flash
Thinking: high
Execution Backend: Antigravity CLI

Antigravity owns its native file, shell, and tool activity. RunWield replay includes committed assistant messages,
RunWield tool activity, and backend status—not Antigravity's internal activity.
```

TUI onboarding says that Agy must be installed and signed in and does not use RunWield API login. Selection permits the
temporary namespaced custom Agent from child 03. First use separately asks before child 04 adds the persistent global
RunWield MCP server and narrow permission.

The option set aside is live `agy models` discovery or free-form model entry. It would expose account/version-specific
models and weaken the selected two-model support contract. A new Workspace settings surface is also unnecessary because
Workspace already has Session model and thinking controls.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/models/model-registry.ts` and focused model tests — replace arbitrary Agy synthesis with the two built-in
  base-model descriptors and expose them through selectable-model and completion paths.
- `src/shared/session/backends/agy-cli/{command,execution-session,failure}.ts` and Agy tests — own the closed RunWield
  thinking-to-Agy effort mapping, pass the base model with the mapped `--effort`, verify the concrete model returned by
  Agy, and preserve selected thinking, mapped effort, and backend model evidence through child 05's status paths.
- `src/cmd/models/` — complete exactly the two supported Agy references and reject direct unsupported or free-form Agy
  IDs while preserving other provider and Claude CLI completion behavior.
- `src/ui/tui/model-selector.ts`, `src/ui/tui/model-setup.ts`, `src/ui/tui/model-welcome.test.ts`,
  `src/ui/tui/model-selector.test.ts`, and `src/ui/tui/terminal-auth-setup.test.ts` — show the two Agy models,
  external-CLI setup guidance, and a no-API-login onboarding path shared by interactive startup and Terminal Auth.
- `src/shared/session/session-transcript-projection.js` and projection tests — project the latest valid committed
  `runwield.execution_backend` fact, including its backend model evidence, without turning it into Session or workflow
  authority.
- `src/ui/workspace/server/session-continuation.js` and Workspace integration tests — expose the two registry-backed Agy
  models through existing Session options and return committed backend facts in timeline snapshots without changing
  Runtime mutation authority or the global RunWield thinking choices.
- `src/ui/workspace/islands/SessionSurface.jsx` and `src/ui/workspace/workspace-session-ux.test.tsx` — show Agy in
  existing model controls and add committed backend disclosure and the Agy replay notice to the existing Session
  sidebar.
- `src/ui/workspace/server/dev-owner-fixtures.ts` and `src/ui/workspace/pages/dev/index.astro` — add a linked Agy
  Session fixture for deterministic desktop and narrow browser checks.
- `docs/prd/runwield.md` and `docs/prd/runwield-core-prd.md` — describe the implemented Core backend, the two supported
  model families and complete thinking-to-effort mapping, setup boundary, replay limit, and separation from RunWield
  Connect.

No new CSS or design-system pattern is expected. Reuse the Session sidebar definition list, existing form controls,
`.notice.muted`, and `--rw-*` tokens. Update `docs/design-system.md` and the shared design-system layer only if
implementation discovery proves an existing pattern cannot express the disclosure.

## Reuse Opportunities

- `src/shared/models/model-registry.ts` — extend the Claude CLI alias/provider definition pattern, but give Agy only the
  two approved base slugs.
- `src/shared/session/session.js#resolveExecutionThinkingLevel` and `buildExecutionSession` — retain current invocation,
  Agent, Project, preset, and Agent Definition precedence; pass the resolved RunWield level to Agy for backend-owned
  mapping.
- `src/shared/session/backends/agy-cli/command.ts` — retain the existing direct argument-array model plus effort shape;
  do not use a shell or manually invent a different Agy command path.
- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — extend the verified aggregate
  snapshot rather than make Workspace inspect raw transcript entries.
- `src/ui/tui/model-setup.ts` — reuse the Claude CLI non-login onboarding branch and neutralize login-only completion
  copy for external CLI choices.
- `src/ui/workspace/islands/SessionSurface.jsx` — reuse its existing model/thinking controls and Session sidebar `<dl>`;
  use the existing muted notice instead of a new card.
- `src/ui/design-system/components.css` and `docs/design-system.md` — reuse the documented notice and metadata patterns;
  do not add component-local colors or a second notice style.

## Implementation Steps

- [ ] The Agy registry exposes exactly `agy-cli/gemini-3.8-flash` and `agy-cli/gemini-3.1-pro` as selectable
      external-CLI models. `getSelectable`, `/model` completions, TUI data, and Workspace data all come from these
      descriptors.
- [ ] `RunWieldModelRegistry.find("agy-cli", id)` rejects every other Agy ID, including concrete `-low`, `-medium`, or
      `-high` IDs and arbitrary non-empty values. Existing saved unsupported Agy references fail with guidance to select
      one of the two supported base models; no live `agy models` discovery or free-form picker path remains.
- [ ] The Agy backend maps RunWield thinking deterministically: `off`, `minimal`, and `low` map to Agy `low` for both
      models; `medium` maps to Flash `medium` and Pro `high`; `high`, `xhigh`, and `max` map to Agy `high` for both
      models. No valid RunWield thinking level is rejected or hidden for Agy.
- [ ] The mapping receives the thinking level after existing invocation, Agent, Project, model-preset, and Agent
      Definition precedence resolves it. Root turns, isolated turns, Prompt Templates, TUI changes, Workspace changes,
      and resumed saved settings therefore use the same Agy effort without changing Session Runtime's model/thinking
      ownership or persistence rules.
- [ ] `prepareAgyCliStreamCommand` receives the selected base model and mapped effort and emits both `--model <base>`
      and `--effort <mapped-level>` exactly once. It still uses direct arguments and preserves child 05's timeout and
      process-tree behavior. The backend expects the exact concrete model for that base/effort pair and treats any
      different reported model as the existing `selection_mismatch` failure.
- [ ] Successful Agy backend metadata keeps `provider: "agy-cli"` and `model` as the selected base-model ID, records the
      selected RunWield thinking level, mapped Agy effort, and concrete backend model, and never replaces the committed
      Session model with the concrete suffix. Failure/status entries retain enough sanitized evidence to explain a model
      mismatch without exposing prompts, global paths, temporary Agent selectors, bridge credentials, or raw Agy output.
- [ ] The TUI model selector lists both Agy models under **Antigravity CLI**, supports search by
      family/reference/backend, and shows install/sign-in plus first-use MCP approval guidance. It does not direct Agy
      users to `/login` for a RunWield API key. Existing Shift+Tab thinking cycling remains unchanged because every
      RunWield level has a mapping.
- [ ] Shared no-model setup offers **Use Antigravity CLI** beside Claude CLI, subscription, and API-key choices. The Agy
      path opens only the two registered choices, persists the accepted model through the existing settings path, and
      uses neutral “model setup” completion copy. Cancel leaves no root Session, and selection alone does not write the
      persistent global MCP files owned by child 04.
- [ ] New and existing Workspace Session composers list the two Agy families through the normal registry-backed model
      control. The adjacent thinking control keeps the normal RunWield levels and existing Session Runtime mutation
      behavior. A pending model or thinking change remains labeled as applying after the current response and does not
      replace committed sidebar facts early.
- [ ] `summarizeProjectedEntries` projects the latest valid committed `runwield.execution_backend` data as backend,
      selected model, RunWield thinking, mapped effort, and concrete backend model. Older or malformed entries do not
      crash projection or become workflow authority. Browser timeline projection passes the safe snapshot fields through
      without reading uncommitted transcript bytes.
- [ ] The Workspace **Session** sidebar renders the committed full model reference, committed RunWield thinking level,
      and **Execution Backend: Antigravity CLI** for an Agy transcript. It shows the approved replay notice only for
      Agy, while the composer may independently show pending model or thinking state.
- [ ] The browser disclosure uses the current Session sidebar definition-list and muted-notice patterns at desktop and
      narrow widths. No CSS or design-system documentation changes land unless a genuinely reusable missing pattern is
      found; any such pattern is added to the shared layer and `docs/design-system.md` in the same change.
- [ ] `docs/prd/runwield.md` and `docs/prd/runwield-core-prd.md` name Agy as a Core Execution Backend, list only the two
      supported base models, document the complete RunWield-thinking-to-Agy-effort mapping, explain external CLI setup
      and replay limits, and keep RunWield Connect as the separate case where an External Agent Host owns the
      conversation and model calls.

## Approval Confirmation

No Work Records are proposed for supersession. The completed Claude CLI Epic is an active precedent, not work this Plan
replaces.

## Verification Plan

- Automated registry and completion behavior:
  `deno run -A scripts/run-tests.js src/shared/models/agy-cli-models.test.ts src/cmd/models/index.test.ts
  src/shared/session/agy-cli-model-selection.test.ts`.
  Assert that every picker and completion source contains exactly the two approved base models; direct arbitrary and
  concrete-suffix references fail before Agy-owned files, processes, bridges, transcript entries, or workflow events
  exist.
- Automated Agy mapping, command, and result behavior:
  `deno run -A scripts/run-tests.js src/shared/session/backends/agy-cli/agy-cli-backend.test.ts
  src/shared/session/agy-cli-execution.test.ts src/shared/session/session-prompt.test.js`.
  For both base models and all seven RunWield thinking levels, a generated fake `agy` must assert the exact base
  `--model` and mapped `--effort`, emit the corresponding concrete model, and complete a real RunWield turn. Include
  saved Project/Agent/preset settings and Prompt Template/root/isolated overrides so each existing thinking source
  demonstrably reaches the same mapping. A wrong returned suffix must enter child 05's sanitized `selection_mismatch`
  path.
- Objective-failing backend check:
  `deno run -A scripts/run-tests.js --filter '^Agy maps every RunWield thinking level to the verified backend model$'
  src/shared/session/agy-cli-execution.test.ts`.
  Iterate all 14 model/thinking inputs through real registry lookup and execution-session construction. Assert exact
  process arguments, one assistant result, committed base model and original RunWield thinking, mapped effort, concrete
  backend-model evidence, and replayed status. The check must fail if the registry exposes placeholders, the backend
  ignores thinking, rejects `off|minimal|xhigh|max`, maps Pro `medium` below `high`, passes a concrete picker ID,
  hard-codes one model, drops result validation, or returns a pass-through response without running the generated
  executable.
- Automated TUI behavior:
  `deno run -A scripts/run-tests.js src/ui/tui/model-selector.test.ts src/ui/tui/model-welcome.test.ts
  src/ui/tui/terminal-auth-setup.test.ts src/ui/tui/chat-input-controller.test.ts`.
  Cover mixed Pi, Claude, and Agy search/selection; exact Agy labels and caveats; no-provider Agy onboarding without
  `/login`; cancellation; model default persistence; unchanged RunWield thinking cycling; and no persistent Antigravity
  MCP config write during selection.
- Automated committed projection and Workspace behavior:
  `deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js
  src/ui/workspace/session-continuation.integration.test.ts src/ui/workspace/workspace-session-ux.test.tsx`.
  Use real committed transcript entries to prove that selected base model, original RunWield thinking, mapped effort,
  Execution Backend, and concrete backend model reach the browser snapshot. Prove the two normal Workspace model
  choices, unchanged global thinking choices, committed-versus-staged separation, Agy-only replay copy, malformed/legacy
  projection safety, and no provider-prefix inference.
- Existing behavior protected: Pi model discovery, auth, model selection, thinking cycle, and execution stay unchanged.
  Claude CLI keeps its four aliases, no-API-login onboarding, current thinking policy, MCP bridge, transcript, and
  replay caveat behavior. Existing non-Agy configured models and OpenRouter-style IDs with slashes still resolve.
  Session Runtime continues to own independent model and thinking changes. No existing released behavior is expected to
  stop.
- Behavior expected to stop: the integration branch no longer accepts arbitrary `agy-cli/<id>` references, hides Agy
  from pickers/completions, rejects Agy `off`, `minimal`, `xhigh`, or `max`, passes an effort-suffixed model as the
  committed Session model, or labels Agy backend status as Claude. The child-03/05 tests that use
  `agy-cli/fixture-model` must be rewritten against approved base models rather than deleted.
- Automated project gates: `deno task check`, `deno task seams:check`, `deno task workspace:check`,
  `deno task doc-links:check`, `deno task test`, and `deno task ci`. Use `scripts/run-tests.js`; never run `deno test`
  directly.
- Manual TUI check with authenticated `agy 1.1.27` or the minimum supported version selected during implementation:
  start with no API provider, choose **Use Antigravity CLI**, and verify only Flash 3.8 and Pro 3.1 appear. Exercise the
  mapping boundaries: Flash `off`/`minimal`/`low` report concrete low, Flash `medium` reports medium, Flash
  `high`/`xhigh`/`max` report high, Pro below `medium` reports low, and Pro `medium` or above reports high. RunWield
  must continue to show the original selected thinking level while Agy reports the mapped concrete model.
- Manual setup-language check: on first real Agy use, verify selection itself creates only child 03's temporary
  namespaced Agent, while child 04 separately asks before persistent MCP server/permission setup. Confirm decline leaves
  the selected model visible but starts no turn, and no copy sends the user through RunWield API-key login.
- Headed browser check: run `deno task workspace:dev`, open `http://127.0.0.1:5173/dev`, follow the linked Agy Session
  fixture, and verify the model/thinking controls and committed Session sidebar at desktop and narrow widths. The
  sidebar must show `agy-cli/gemini-3.8-flash`, the original RunWield thinking, **Antigravity CLI**, and the replay
  notice; a staged model or thinking change must not alter those committed values. Verify keyboard access, readable
  wrapping, existing focus styles, and no console errors.
- Documentation check: the two PRDs must agree with implemented picker IDs, the complete thinking-to-effort mapping,
  command behavior, setup boundary, transcript caveat, and Core-versus-Connect ownership. No unsupported Antigravity
  family or free-form entry is described.

## Edge Cases & Considerations

- The installed Agy catalog can add models without changing RunWield's supported set. New `agy models` output does not
  enter pickers automatically; support expansion requires an intentional registry change and tests.
- Agy 1.1.27 accepts a base slug only with `--effort`. The approved mapping deliberately folds RunWield's seven levels
  into Flash's three and Pro's two. Treat a changed CLI contract or unexpected concrete result as a failed preflight or
  selection mismatch; do not add a new fallback outside this table.
- Persist the RunWield base reference and thinking level as Session choices. The concrete Agy model is execution
  evidence, not a replacement setting; otherwise a later thinking change would appear to change the model family.
- Unsupported arbitrary Agy references existed only on the shared integration branch. No user-data migration is planned.
  If a local setting already uses one, fail clearly and require selection of one approved family rather than rewriting
  it.
- Workspace disclosure uses the latest verified committed backend entry. It must not use pending composer state, current
  registry defaults, raw uncommitted JSONL, or Antigravity conversation data.
- Agy selection authorizes temporary namespaced custom-Agent materialization, not persistent global MCP changes.
  Preserve child 04's explicit approval, conflict refusal, and no-secret persistence rules.
- The shared feature branch is behind current `main`, and both branches changed Session and Workspace code. Before
  edits, reconcile the actual post-child-05 target with current source patterns. Preserve newer Session sidebar, shell,
  navigation, and Runtime mutation behavior rather than restoring the draft's older summary-card assumptions.
- Browser work must use existing `--rw-*` tokens and design-system patterns. If browser fixture/API state blocks headed
  verification, record the blocker and the closest deterministic evidence; do not claim the visual check passed.
- Tests use sandboxed `HOME`, generated executables, and `withProcessGlobalTestLock` where process-global state changes.
  They must not read or modify the developer's real Antigravity files or add a RunWield-owned injection seam.
