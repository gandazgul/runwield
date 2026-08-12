---
planId: "3847a3dc-3271-42c1-b578-8b9b10e62ef1"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Upgrade the four Pi packages to 0.84.0, adopt built-in Unicode LaTeX rendering, and migrate RunWield to Pi's public TuiMainScreen API without changing Mermaid behavior."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/ui/tui/tui.js"
    - "src/ui/tui/tui.ts"
    - "src/ui/tui/tui.test.ts"
    - "src/ui/tui/keybindings.js"
    - "src/ui/tui/keybindings.ts"
    - "src/ui/tui/keybindings.test.js"
    - "src/ui/tui/chat-input-controller.ts"
    - "src/ui/tui/chat-session.ts"
    - "src/ui/tui/interactive-tui-composition.ts"
    - "src/ui/tui/markdown-latex.test.ts"
    - "src/ui/tui/boot-banner.test.ts"
    - "src/ui/tui/model-selector.test.ts"
    - "src/ui/tui/terminal-title.test.ts"
    - "src/ui/tui/ui-api-overrides.test.ts"
    - "src/ui/tui/boot-logo.ts"
    - "src/ui/tui/terminal-title.ts"
    - "src/ui/tui/testing/interactive-composition-fixture.ts"
    - "src/ui/tui/testing/scenario-runner.js"
    - "src/cmd/agents/index.test.ts"
    - "src/cmd/quit/index.ts"
    - "src/cli.ts"
    - "src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts"
    - "src/shared/session/session-context-resilience.test.js"
    - "scripts/language-policy-baseline.json"
    - "docs/usage.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q '^status: \"verified\"' docs/plans/split-and-convert-tui-chat-session.md && deno eval 'const c=JSON.parse(await Deno.readTextFile(\"deno.json\"));const e={\"@earendil-works/pi-tui\":\"npm:@earendil-works/pi-tui@^0.84.0\",\"@earendil-works/pi-ai\":\"npm:@earendil-works/pi-ai@^0.84.0\",\"@earendil-works/pi-coding-agent\":\"npm:@earendil-works/pi-coding-agent@^0.84.0\",\"@earendil-works/pi-agent-core\":\"npm:@earendil-works/pi-agent-core@^0.84.0\"};for(const [k,v] of Object.entries(e))if(c.imports[k]!==v)throw new Error(`wrong Pi import ${k}`);const l=JSON.stringify(JSON.parse(await Deno.readTextFile(\"deno.lock\")));if(/@earendil-works\\/pi-(tui|ai|coding-agent|agent-core)[^\" ]*0\\.82\\.1/.test(l))throw new Error(\"stale Pi 0.82.1 lock entry\")' && deno task check"
      rationale: "Parses the real import map and lock data, then proves the verified prerequisite, coherent Pi family upgrade, stale-version removal, and API compatibility."
    - id: "OC2"
      command: "deno eval 'import stripAnsi from \"strip-ansi\";import {MermaidMarkdown} from \"./src/ui/tui/mermaid-markdown.js\";import {getMarkdownTheme,initRunWieldTheme} from \"./src/ui/theme/theme.js\";initRunWieldTheme();const r=(s)=>stripAnsi(new MermaidMarkdown(s,0,0,getMarkdownTheme()).render(120).join(\"\\n\"));const m=r(\"Inline $x^2$ and $\\\\alpha + \\\\beta$.\");if(!m.includes(\"x²\")||!m.includes(\"α + β\")||m.includes(\"\\\\alpha\"))throw new Error(\"Unicode LaTeX missing\");const p=r(\"Inline $\\\\alpha\");if(!p.includes(\"$\\\\alpha\"))throw new Error(\"pending source lost\");const d=r(\"```mermaid\\ngraph TD\\n A --> B\\n```\");if(!d.includes(\"┌\")||d.includes(\"```mermaid\"))throw new Error(\"Mermaid regression\")'"
      rationale: "Directly exercises RunWield's real Markdown adapter and passes only when completed LaTeX becomes Unicode, pending source survives, and completed Mermaid still renders."
    - id: "OC3"
      command: "test ! -e src/ui/tui/tui.js && test -f src/ui/tui/tui.ts && grep -q 'TuiCtor: TuiMainScreen' src/ui/tui/tui.ts && ! grep -Eq '@ts-(no)?check' src/ui/tui/tui.ts && ! grep -Rqs 'new TUI(' src/ui/tui src/cmd && deno run -A scripts/run-tests.js --filter 'TUI singleton uses Pi TuiMainScreen regular mode' src/ui/tui/tui.test.ts"
      rationale: "Proves production construction moved to the public regular-screen implementation and a named runtime test protects the selected mode."
    - id: "OC4"
      command: "deno eval 'const c=JSON.parse(await Deno.readTextFile(\"deno.json\"));if(c.imports[\"@earendil-works/pi-tui\"]!==\"npm:@earendil-works/pi-tui@^0.84.0\")throw new Error(\"Pi TUI not upgraded\");if(c.imports[\"beautiful-mermaid\"]!==\"npm:beautiful-mermaid@^1.1.3\")throw new Error(\"beautiful-mermaid changed\");if(Object.hasOwn(c.imports,\"grok-mermaid\"))throw new Error(\"direct grok-mermaid dependency\")' && ! grep -Rqs 'grok-mermaid' src && deno run -A scripts/run-tests.js src/ui/tui/mermaid-markdown.test.js"
      rationale: "Proves the Pi upgrade lands while RunWield retains beautiful-mermaid and has no direct source use of Pi's transitive renderer."
    - id: "OC5"
      command: "test ! -e src/ui/tui/keybindings.js && test -f src/ui/tui/keybindings.ts && grep -q 'interface KeybindingsContext' src/ui/tui/keybindings.ts && grep -q 'installKeybindings(ctx: KeybindingsContext)' src/ui/tui/keybindings.ts && ! grep -Eq '@ts-(no)?check|:\\s*any\\b|:\\s*unknown\\b' src/ui/tui/keybindings.ts && ! grep -Fq 'src/ui/tui/keybindings.js' scripts/language-policy-baseline.json && ! grep -Fq 'src/ui/tui/tui.js' scripts/language-policy-baseline.json && deno run -A scripts/run-tests.js src/ui/tui/keybindings.test.js"
      rationale: "Proves the two selected TypeScript migrations are checked, typed, ratcheted, and preserve the existing keybinding suite."
    - id: "OC6"
      command: "deno eval 'const c=JSON.parse(await Deno.readTextFile(\"deno.json\"));if(c.imports[\"@earendil-works/pi-tui\"]!==\"npm:@earendil-works/pi-tui@^0.84.0\")Deno.exit(1)' && deno task ci"
      rationale: "Prevents a narrow compatibility counterfeit from passing with deleted tests, broken Golden TUI behavior, a new seam, or repository-wide failures."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-06T15:26:09-04:00"
status: "verified"
origin: "internal"
dependencies:
    - "split-and-convert-tui-chat-session"
implementedAt: "2026-08-12T03:26:19.444Z"
verifiedAt: "2026-08-12T04:19:28.540Z"
userVerifiedAt: null
executionReport: "- Implemented Pi package upgrade to `^0.84.0`, regenerated `deno.lock`, kept `beautiful-mermaid` direct, and left `grok-mermaid` only transitive with no RunWield source imports.\n- Replaced the old TUI singleton/keybinding JS modules with typed `tui.ts` and `keybindings.ts`; production and deterministic paths now use Pi `TuiMainScreen` regular mode, with no direct `new TUI(...)` construction left.\n- Added `scopedModels: []` to the Claude CLI MCP bridge context and guarded the session resilience stream helper against final `done` events with `stopReason: \"pending\"`.\n- Added RunWield-level Unicode LaTeX coverage through `MermaidMarkdown` and documented completed math delimiters, fallback behavior, and Mermaid coexistence in `docs/usage.md`.\n- Test changes: +10 `Deno.test` cases added, no tests removed; existing keybinding fake was updated for the public editor newline insertion path.\n- Verification passed: `deno task check`, `deno task language-policy:check`, `deno task seams:check`, all focused TUI/Markdown/MCP/session/chat/golden suites, OC1–OC6 commands, mutation checks for LaTeX disable, alt-screen mode, and pending final stop reason, and full `deno task ci`.\n- Manual `deno task cli` TUI smoke was not run because this API session has no interactive terminal; the equivalent behavior was covered by automated `MermaidMarkdown`, TUI regular-mode, and Golden TUI checks."
workRecord:
    status: "generated"
    recordId: "f9ada355-3d09-4e27-9c13-1133a3e8b339"
    path: "docs/work-records/2026-08-12-upgrade-pi-0-84-and-unicode-latex-rendering.md"
    lastAttemptAt: "2026-08-12T04:19:37.656Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-12T04:19:27.436Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "cae6c87802d1bddeb50f22996a6a1adce764331b"
    targetBranch: "main"
    targetHeadBeforeMerge: "e5986a6abf3dc60acb5f2f9cd2992a5b7fa7ebe9"
routingIntent: "PLANNED_CHANGE"
sessionName: "upgrade pi and rendering"
validationCiAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-12T14:57:43.883Z"
archivedAt: "2026-08-12T14:57:43.883Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/upgrade-pi-0-84-and-latex-rendering.md"
---

# Upgrade Pi to 0.84 and Render LaTeX

## Context

RunWield currently pins these four direct dependencies to `^0.82.1`:

- `@earendil-works/pi-tui`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`

Pi 0.84.0 adds terminal-friendly Unicode LaTeX rendering to its public `Markdown` component. For example,
`Inline $x^2$ and $\alpha + \beta$.` renders as `Inline x² and α + β.`. RunWield's `MermaidMarkdown` subclasses that
public component, so the new behavior is available without a second math renderer or a RunWield-owned transformation.

Pi 0.84.0 also replaces the old concrete `TUI` export with a public `TUI` interface and two implementations. RunWield
uses the normal terminal screen and scrollback today, so the compatible concrete owner is `TuiMainScreen`, not the
fullscreen `TuiAltScreen`.

This Plan depends on `split-and-convert-tui-chat-session`. Execution must not start until that Plan is verified and its
TypeScript chat/session composition modules are present. The dependency is also recorded in Front Matter. RunWield's
current dependency resolver enforces dependencies between sibling Epic children; for these standalone Plans, the
verification checks also require the prerequisite Plan to be verified.

The Mermaid decision is settled. Keep `beautiful-mermaid@^1.1.3` and the existing completed-fence behavior. Do not
import or call Pi's private Mermaid implementation or `grok-mermaid`. The user accepts `grok-mermaid` only as an unused
transitive dependency required by Pi 0.84.0.

## Objective

Upgrade all four Pi packages and the lockfile to 0.84.0, use Pi's public `TuiMainScreen` implementation directly, and
make only the compatibility changes exposed by the upgraded type check and focused runtime tests. Terminal Markdown must
render supported completed LaTeX as Unicode while preserving incomplete or unsupported source. Existing Mermaid,
terminal-screen, Session, model, input, and lifecycle behavior must remain unchanged.

## Approach

- Update the four direct Pi specifiers together so Pi's package family stays on one compatible version. Regenerate the
  Deno lockfile through normal Deno dependency resolution; do not hand-edit transitive entries.
- Replace construction of the removed concrete `TUI` class with direct `TuiMainScreen` construction. Keep `TUI` as a
  type where callers need the shared interface. Do not add a compatibility adapter or select fullscreen mode.
- Purposefully convert the small implementation modules `tui.js` and `keybindings.js` to TypeScript. Update their
  callers. Existing JavaScript callers, including `testing/scenario-runner.js` and `keybindings.test.js`, receive only
  required import-path or Pi-API edits and remain JavaScript under the user-confirmed repository policy.
- Add the required empty `scopedModels` snapshot to the Claude CLI Model Context Protocol (MCP) tool context. It has no
  scoped models because the bridge captures its eligible product tools at factory time and does not expose model choice.
- Narrow the test stream helper's stop reason before emitting Pi's final `done` event. Pi 0.84 allows `"pending"` on an
  `AssistantMessage`, but a final `done` event cannot use that reason. Reject accidental pending input in the helper
  instead of coercing it to a false final state.
- Verify Unicode math through `MermaidMarkdown`, not through Pi's `Markdown` alone. This proves RunWield's actual Agent
  message renderer inherits LaTeX behavior while its Mermaid transformation remains active.

## Files to Modify

- `deno.json` — change all four direct `@earendil-works/pi-*` versions from `^0.82.1` to `^0.84.0`; retain
  `beautiful-mermaid@^1.1.3` and do not add `grok-mermaid` directly.
- `deno.lock` — regenerate the resolved Pi 0.84.0 package graph. Accept `grok-mermaid` only in the transitive graph and
  remove stale Pi 0.82.1 resolutions.
- `src/ui/tui/tui.js` / `src/ui/tui/tui.ts` — replace the JavaScript singleton entry point with a typed module that
  composes `ProcessTerminal`, `TuiMainScreen`, the existing `createTuiManager`, crash guards, focus reporting, and title
  restoration. Keep the existing `initTUI`, `initTUIWithPair`, `getTUI`, and `stopTUI` interface.
- `src/ui/tui/tui.test.ts` — prove the singleton accepts a real compatible Terminal/TUI pair, reports regular-screen
  mode, and preserves idempotent stop/cleanup behavior.
- `src/ui/tui/keybindings.js` / `src/ui/tui/keybindings.ts` — purposefully migrate the small keybinding module to native
  TypeScript while preserving every binding and command; import `stopTUI` from `tui.ts`.
- `src/ui/tui/keybindings.test.js` and `src/ui/tui/chat-input-controller.ts` — update the keybinding module extension
  and preserve behavior coverage.
- `src/ui/tui/chat-session.ts` and `src/ui/tui/interactive-tui-composition.ts` — use the typed singleton interface and
  construct `TuiMainScreen` for explicit deterministic terminal composition.
- `src/ui/tui/boot-banner.test.ts`, `model-selector.test.ts`, `terminal-title.test.ts`, `ui-api-overrides.test.ts`, and
  `src/cmd/agents/index.test.ts` — replace test construction of the removed `TUI` class with `TuiMainScreen` while
  preserving the same virtual Terminal and assertions.
- `src/ui/tui/boot-logo.ts`, `terminal-title.ts`, `testing/interactive-composition-fixture.ts`,
  `testing/scenario-runner.js`, `src/cmd/quit/index.ts`, and `src/cli.ts` — update repository-local imports from
  `tui.js` to `tui.ts`. Keep `scenario-runner.js` as JavaScript and make no other change there.
- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts` — add `scopedModels: []` to the minimal Pi 0.84
  `ExtensionContext` used by bridged lifecycle tools.
- `src/shared/session/session-context-resilience.test.js` — reject the new non-final `"pending"` stop reason before
  emitting a final `done` event; keep this existing test module in JavaScript.
- `src/ui/tui/markdown-latex.test.ts` — add RunWield-level integration coverage for inline, display, incomplete,
  unsupported, and Mermaid-adjacent Markdown rendering.
- `scripts/language-policy-baseline.json` — remove the converted `tui.js` and `keybindings.js` entries. Keep existing
  JavaScript callers on the baseline; do not create new JavaScript files.
- `docs/usage.md` — document supported terminal Unicode math delimiters and fallback behavior under Interactive
  Sessions.

## Reuse Opportunities

- `src/ui/tui/mermaid-markdown.js::MermaidMarkdown` — use the existing RunWield Markdown owner so one rendered message
  can contain both Unicode math and completed Mermaid diagrams.
- `src/ui/tui/tui-manager.ts::createTuiManager` — retain singleton, focus-reporting, crash-guard, explicit-pair, and
  reverse cleanup behavior; only change its concrete production TUI constructor.
- `src/ui/tui/testing/virtual-terminal.js::VirtualTerminal` — use the real deterministic Terminal fixture for
  `TuiMainScreen` tests instead of adding a product seam.
- Existing Mermaid tests in `src/ui/tui/mermaid-markdown.test.js` and Agent block tests in `blocks.test.js` — retain
  these as regression protection for final-fence rendering, width fallback, and actual Agent message composition.
- Pi 0.84 public `MarkdownOptions.renderLatex` — rely on its default `true`; do not add a RunWield setting or duplicate
  option unless an existing caller explicitly disables it.

## Implementation Steps

- [ ] The prerequisite `docs/plans/split-and-convert-tui-chat-session.md` has `status: "verified"`; the old
      `src/ui/tui/chat-session.js` is absent; and the TypeScript chat/session composition interfaces required by this
      Plan exist before dependency edits begin.
- [ ] `deno.json` specifies `^0.84.0` for all four direct Pi packages, and `deno.lock` contains the resolved 0.84.0
      family with no Pi 0.82.1 package resolution. `beautiful-mermaid` remains direct and unchanged; `grok-mermaid` is
      absent from `deno.json` and all RunWield imports.
- [ ] `src/ui/tui/tui.ts` directly constructs `TuiMainScreen` over `ProcessTerminal` and uses the public `TUI` and
      `Terminal` interfaces for the existing singleton and explicit-pair contract. It does not contain a legacy-TUI
      adapter, fullscreen selection, `any`, `unknown`, or a property-free object type.
- [ ] The production and deterministic composition paths use `TuiMainScreen` and preserve `mode === "regular"`, normal
      terminal scrollback, component/focus behavior, crash guards, focus reporting, title restoration, and idempotent
      cleanup. Every direct `new TUI(...)` value construction is gone; type-only `TUI` imports remain valid.
- [ ] `src/ui/tui/keybindings.ts` owns the same key map and behavior as `keybindings.js`, declares and uses the named
      `KeybindingsContext` TypeScript interface, and contains no `@ts-check` escape, `any`, `unknown`, or property-free
      object type. No keybinding is added, removed, or reassigned.
- [ ] All callers use the new `.ts` module paths. `testing/scenario-runner.js`, `keybindings.test.js`, and the modified
      Session resilience test remain JavaScript with focused compatibility edits only, as explicitly selected by the
      user and permitted by the current `AGENTS.md` policy.
- [ ] The Claude CLI MCP bridge supplies `scopedModels: []` in its minimal Pi extension context. Existing authenticated
      lifecycle-tool advertisement, execution, provenance, and close behavior remain unchanged.
- [ ] The Session context-resilience stream helper cannot emit `done` with `stopReason: "pending"`; it reports a clear
      fixture error for that invalid final state and continues to emit `error` for `"error"`/`"aborted"` and `done` for
      `"stop"`, `"length"`, `"toolUse"`, and `"deferred"`.
- [ ] `MermaidMarkdown` renders completed inline `$...$`/`\(...\)` and display `$$...$$`/`\[...\]` expressions with Pi's
      Unicode renderer. Incomplete streamed expressions and unsupported expressions preserve readable source instead of
      disappearing or throwing.
- [ ] Existing completed top-level Mermaid fences still render through `beautiful-mermaid` only after their closing
      fence; partial, malformed, unsupported, nested, or over-width diagrams still fall back to source. No RunWield
      source imports or calls `grok-mermaid`, and no private Pi Mermaid code is copied.
- [ ] `docs/usage.md` describes the implemented Unicode math delimiters, completed-expression behavior, source fallback,
      and coexistence with Mermaid without presenting either renderer as a configurable setting.
- [ ] Focused compatibility tests, all Golden TUI scenarios, language/seam ratchets, and full continuous integration
      pass. No user-visible behavior stops existing; Unicode LaTeX rendering is the only intended new behavior.

## Verification Plan

- Dependency/type gates:
  - `deno task check`
  - `deno task language-policy:check`
  - `deno task seams:check`
  - Confirm `deno.lock` has no resolved Pi 0.82.1 package and `deno.json` has no direct `grok-mermaid` entry.
- Focused behavior:
  - `deno run -A scripts/run-tests.js src/ui/tui/markdown-latex.test.ts src/ui/tui/mermaid-markdown.test.js src/ui/tui/blocks.test.js`
  - `deno run -A scripts/run-tests.js src/ui/tui/tui.test.ts src/ui/tui/tui-manager.test.ts src/ui/tui/boot-banner.test.ts src/ui/tui/model-selector.test.ts src/ui/tui/terminal-title.test.ts src/ui/tui/ui-api-overrides.test.ts src/ui/tui/keybindings.test.js src/cmd/agents/index.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/workflow-mcp-bridge.test.ts src/shared/session/session-context-resilience.test.js`
  - Run the post-prerequisite chat-session and Golden TUI suites under their resulting `.ts`/`.js` paths.
- Full gate: `deno task ci`.
- Mutation proof:
  - Temporarily set `renderLatex: false` in the RunWield Markdown construction and confirm the named Unicode math test
    fails, then restore default behavior.
  - Temporarily construct `TuiAltScreen` and confirm the regular-mode test fails, then restore `TuiMainScreen`.
  - Temporarily allow `"pending"` through the final test-stream event and confirm type checking or the named guard test
    fails, then restore the guard.
- Manual TUI smoke check with `deno task cli`: submit one response containing inline Greek/superscript math, one display
  fraction or summation, one incomplete expression, and one completed Mermaid flowchart. Confirm math is readable
  Unicode, incomplete source stays visible, Mermaid appears only after completion, normal terminal scrollback remains
  available, and exit restores terminal state.
- Expected preserved behavior: regular-screen TUI rendering, input keys, model selection, Agent message Markdown,
  Mermaid fallback, Session flow, MCP lifecycle tools, and cleanup. Expected removed behavior: construction of Pi's
  former concrete `TUI` class and Pi 0.82.1 lock resolutions only.

### Objective-Failing Checks

- `OC1` —
  `grep -q '^status: "verified"' docs/plans/split-and-convert-tui-chat-session.md && deno eval 'const c=JSON.parse(await Deno.readTextFile("deno.json"));const e={"@earendil-works/pi-tui":"npm:@earendil-works/pi-tui@^0.84.0","@earendil-works/pi-ai":"npm:@earendil-works/pi-ai@^0.84.0","@earendil-works/pi-coding-agent":"npm:@earendil-works/pi-coding-agent@^0.84.0","@earendil-works/pi-agent-core":"npm:@earendil-works/pi-agent-core@^0.84.0"};for(const [k,v] of Object.entries(e))if(c.imports[k]!==v)throw new Error(`wrong
  Pi import
  ${k}`);const l=JSON.stringify(JSON.parse(await Deno.readTextFile("deno.lock")));if(/@earendil-works\\/pi-(tui|ai|coding-agent|agent-core)[^" ]*0\\.82\\.1/.test(l))throw new Error("stale Pi 0.82.1 lock entry")' && deno task check`
  — parses the real import map and lock data, then proves the verified prerequisite, coherent Pi family upgrade,
  stale-version removal, and required API compatibility together.
- `OC2` —
  ``deno eval 'import stripAnsi from "strip-ansi";import {MermaidMarkdown} from "./src/ui/tui/mermaid-markdown.js";import {getMarkdownTheme,initRunWieldTheme} from "./src/ui/theme/theme.js";initRunWieldTheme();const r=(s)=>stripAnsi(new MermaidMarkdown(s,0,0,getMarkdownTheme()).render(120).join("\n"));const m=r("Inline $x^2$ and $\\alpha + \\beta$.");if(!m.includes("x²")||!m.includes("α + β")||m.includes("\\alpha"))throw new Error("Unicode LaTeX missing");const p=r("Inline $\\alpha");if(!p.includes("$\\alpha"))throw new Error("pending source lost");const d=r("```mermaid\ngraph TD\n A --> B\n```");if(!d.includes("┌")||d.includes("```mermaid"))throw new Error("Mermaid regression")'``
  — directly exercises RunWield's real Markdown adapter and can pass only when completed LaTeX becomes Unicode, pending
  source survives, and completed Mermaid still renders.
- `OC3` —
  `test ! -e src/ui/tui/tui.js && test -f src/ui/tui/tui.ts && grep -q 'TuiCtor: TuiMainScreen' src/ui/tui/tui.ts && ! grep -Eq '@ts-(no)?check' src/ui/tui/tui.ts && ! grep -Rqs 'new TUI(' src/ui/tui src/cmd && deno run -A scripts/run-tests.js --filter 'TUI singleton uses Pi TuiMainScreen regular mode' src/ui/tui/tui.test.ts`
  — proves production construction moved to the public regular-screen implementation and a named runtime test protects
  the selected mode.
- `OC4` —
  `deno eval 'const c=JSON.parse(await Deno.readTextFile("deno.json"));if(c.imports["@earendil-works/pi-tui"]!=="npm:@earendil-works/pi-tui@^0.84.0")throw new Error("Pi TUI not upgraded");if(c.imports["beautiful-mermaid"]!=="npm:beautiful-mermaid@^1.1.3")throw new Error("beautiful-mermaid changed");if(Object.hasOwn(c.imports,"grok-mermaid"))throw new Error("direct grok-mermaid dependency")' && ! grep -Rqs 'grok-mermaid' src && deno run -A scripts/run-tests.js src/ui/tui/mermaid-markdown.test.js`
  — proves the Pi upgrade lands while RunWield retains its existing Mermaid dependency and has no direct source use of
  Pi's transitive renderer.
- `OC5` —
  `test ! -e src/ui/tui/keybindings.js && test -f src/ui/tui/keybindings.ts && grep -q 'interface KeybindingsContext' src/ui/tui/keybindings.ts && grep -q 'installKeybindings(ctx: KeybindingsContext)' src/ui/tui/keybindings.ts && ! grep -Eq '@ts-(no)?check|:\\s*any\\b|:\\s*unknown\\b' src/ui/tui/keybindings.ts && ! grep -Fq 'src/ui/tui/keybindings.js' scripts/language-policy-baseline.json && ! grep -Fq 'src/ui/tui/tui.js' scripts/language-policy-baseline.json && deno run -A scripts/run-tests.js src/ui/tui/keybindings.test.js`
  — proves the two explicitly selected TypeScript migrations are checked, typed, ratcheted, and preserve the existing
  keybinding suite.
- `OC6` —
  `deno eval 'const c=JSON.parse(await Deno.readTextFile("deno.json"));if(c.imports["@earendil-works/pi-tui"]!=="npm:@earendil-works/pi-tui@^0.84.0")Deno.exit(1)' && deno task ci`
  — prevents a narrow compatibility counterfeit from passing with deleted tests, broken Golden TUI behavior, a new seam,
  or repository-wide failures; it is red today at the parsed version gate.

## Edge Cases & Considerations

- Do not execute this Plan against the pre-split `chat-session.js` tree. The verified prerequisite defines the typed
  composition boundaries that this upgrade must update.
- Pi's LaTeX tokenizer deliberately treats some currency-like dollar text as prose. Tests must use unambiguous math and
  must not redefine Pi's parsing heuristics.
- During streaming, Pi leaves pending LaTeX source visible until a closing delimiter arrives. Preserve this behavior; do
  not render partial formulas or remove their delimiters early.
- Unicode math is terminal text, not an image. Complex formulas can use multiple terminal lines and remain constrained
  by terminal width.
- `TuiMainScreen` is the semantic replacement for RunWield's existing regular screen. `TuiAltScreen` would remove normal
  scrollback and is out of scope.
- The new Pi `"pending"` stop reason is valid on an intermediate `AssistantMessage`, but not on a final `done` stream
  event. Narrow it only at the final-event test helper; do not globally erase it from Pi-facing types.
- The lockfile can contain `grok-mermaid` because Pi 0.84.0 depends on it. RunWield must never list it directly, import
  it, call it, copy its source, or describe it as RunWield's Mermaid renderer.
- Preserve the user's unrelated `AGENTS.md` policy edit and all other dirty documentation/Agent-definition work. This
  Plan modifies only its listed paths.
