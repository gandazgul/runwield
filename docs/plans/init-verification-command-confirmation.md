---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make Init infer, confirm, and safely persist each project's verification command."
affectedPaths:
    - "src/agent-definitions/subagent-definitions/init-agent-prompt.md"
    - "src/cmd/init/index.ts"
    - "src/cmd/init/index.test.ts"
    - "src/cmd/init/init-verification-confirmation.integration.test.ts"
    - "src/shared/session/subagent-definitions.test.ts"
    - "src/tools/init-verification-command.ts"
    - "src/tools/init-verification-command.test.ts"
    - "docs/settings.md"
objectiveChecks:
    - id: "OC1"
      command: "out=$(deno run -A scripts/run-tests.js src/cmd/init/init-verification-confirmation.integration.test.ts 2>&1) && printf '%s' \"$out\" | grep -q 'init confirms and saves verification through the real interaction flow'"
      rationale: "The required real-runtime interaction test does not exist today and must exercise the named Init confirmation flow rather than passing through the existing Init suite."
    - id: "OC2"
      command: "deno eval 'import {createInitVerificationCommandOperation as c} from \"./src/tools/init-verification-command.ts\"; const r=await Deno.makeTempDir(); const o=c({projectRoot:r}); await o.tool.execute(\"oc\",{verificationNotImplemented:true}); const s=JSON.parse(await Deno.readTextFile(r+\"/.wld/settings.json\")); if(s.verification_command!==`echo \"verification not implemented yet\"`||o.getConfirmedCommand()!==s.verification_command) Deno.exit(1)'"
      rationale: "This executes the new operation and can pass only when the explicit no-verification outcome persists the exact project setting and emits the completion receipt used to gate Init success."
    - id: "OC3"
      command: "deno eval 'import {loadSubAgentDefinition as l} from \"./src/shared/session/subagent-definitions.ts\"; import {SUBAGENTS} from \"./src/constants.js\"; const d=await l(SUBAGENTS.INIT); for(const t of [\"user_interview\",\"init_save_verification_command\"]) if(!d.tools.includes(t)) Deno.exit(1); for(const s of [\"No verification command\",\"verification not implemented yet\",\"cancels\"]) if(!d.systemPrompt.includes(s)) Deno.exit(1)'"
      rationale: "The current effective Init Agent lacks both interaction tools and the required confirmation, placeholder, and cancellation contract."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-20T19:59:44-04:00"
status: "user_verified"
origin: "internal"
implementedAt: "2026-08-24T12:28:52.000Z"
userVerifiedAt: "2026-08-24T12:28:52.000Z"
userVerificationNote: "Recovered, integrated, and accepted by the user with Codex before the publication state-machine migration."
executionReport: "Init now discovers verification-command candidates, confirms the choice with the user, persists it through RunWield-owned settings authority, and covers the real interaction and no-verification paths."
routingIntent: "PLANNED_CHANGE"
sessionName: "init verification command"
planId: "b2208e8a-cdf1-459a-a5cb-32904282528d"
objectiveChecksBaseline:
    recordedAt: "2026-08-21T00:15:13.418Z"
    head: "e8aaa4dfd210c0b193ca22124217bd07e1b92227"
    results:
        - id: "OC1"
          command: "out=$(deno run -A scripts/run-tests.js src/cmd/init/init-verification-confirmation.integration.test.ts 2>&1) && printf '%s' \"$out\" | grep -q 'init confirms and saves verification through the real interaction flow'"
          rationale: "The required real-runtime interaction test does not exist today and must exercise the named Init confirmation flow rather than passing through the existing Init suite."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 61
          output: "\n"
        - id: "OC2"
          command: "deno eval 'import {createInitVerificationCommandOperation as c} from \"./src/tools/init-verification-command.ts\"; const r=await Deno.makeTempDir(); const o=c({projectRoot:r}); await o.tool.execute(\"oc\",{verificationNotImplemented:true}); const s=JSON.parse(await Deno.readTextFile(r+\"/.wld/settings.json\")); if(s.verification_command!==`echo \"verification not implemented yet\"`||o.getConfirmedCommand()!==s.verification_command) Deno.exit(1)'"
          rationale: "This executes the new operation and can pass only when the explicit no-verification outcome persists the exact project setting and emits the completion receipt used to gate Init success."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-init-verification-command-confirmation-a7e25652/src/tools/init-verification-command.ts\".\n"
          exitCode: 1
          durationMs: 34
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-init-verification-command-confirmation-a7e25652/src/tools/init-verification-command.ts\".\n"
        - id: "OC3"
          command: "deno eval 'import {loadSubAgentDefinition as l} from \"./src/shared/session/subagent-definitions.ts\"; import {SUBAGENTS} from \"./src/constants.js\"; const d=await l(SUBAGENTS.INIT); for(const t of [\"user_interview\",\"init_save_verification_command\"]) if(!d.tools.includes(t)) Deno.exit(1); for(const s of [\"No verification command\",\"verification not implemented yet\",\"cancels\"]) if(!d.systemPrompt.includes(s)) Deno.exit(1)'"
          rationale: "The current effective Init Agent lacks both interaction tools and the required confirmation, placeholder, and cancellation contract."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 62
          output: "\n"
updatedAt: "2026-08-24T12:28:52.000Z"
---

# Confirm the Project Verification Command During Init

## Context

RunWield Init inspects test and continuous integration configuration and stores validation facts in project Memory, but
it does not ask the user which command represents the project's full verification. Workflow Validation discovers a
missing `verification_command` later and asks for free text at that point.

The user wants Init to make an evidence-based guess, confirm it while project context is fresh, and save the result as
the project-scoped `verification_command` in `<project>/.wld/settings.json`. If the project has no verification command,
Init must save `echo "verification not implemented yet"` so later Workflow Validation has an explicit, visible
placeholder.

## Objective

Extend the one-time Init flow so it always presents repository-derived verification candidates for user confirmation and
safely persists the confirmed result through RunWield's project settings authority. The flow must support a single
strong candidate, multiple uncertain candidates, a user-supplied command or explanation through **Other**, and an
explicit **No verification command** choice.

## Approach

Keep discovery and conversation in the Init Agent, but keep settings mutation in RunWield-owned code:

```text
Init inspects package scripts, task files, CI, and project docs
  -> user_interview confirms a candidate, Other, or No verification command
  -> init_save_verification_command
  -> setCustomSetting("verification_command", value, "project", projectRoot)
  -> <project>/.wld/settings.json
```

Add a narrow Init verification operation that exposes an Init-only Custom Tool and records an in-memory success receipt.
The tool accepts either a non-empty confirmed command or the explicit no-verification outcome. It maps the
no-verification outcome to the exact placeholder command and delegates the write to `setCustomSetting`, which already
handles project-root resolution, JSONC input, locking, preservation of other keys, and settings reload. `runInitCommand`
supplies the operation's tool with the current Project root and requires its success receipt before it accepts the
domain language artifact or records Init completion. The Init Agent gains `user_interview` for structured confirmation
and calls the settings tool only after the user resolves the choice.

An existing project `verification_command` is the leading candidate, not an instruction to skip confirmation. If
**Other** contains a shell command, Init confirms and saves it. If it contains only an explanation, Init asks a focused
follow-up until it has a command or an explicit no-verification answer. Canceling confirmation leaves Init incomplete
and does not invent or save a choice.

The set-aside option is direct model use of `write` against `.wld/settings.json`; that would bypass settings locking,
JSONC parsing, primary-checkout resolution, and in-memory reload.

## Files to Modify

- `src/agent-definitions/subagent-definitions/init-agent-prompt.md` — add the ordered verification-command discovery,
  confirmation, persistence, cancellation, and user-authority rules; declare `user_interview` and the Init-only settings
  tool.
- `src/tools/init-verification-command.ts` — define the Init-only settings operation, its Custom Tool and success
  receipt, and map the explicit no-verification outcome to the exact placeholder before using the project-scoped
  settings API.
- `src/tools/init-verification-command.test.ts` — verify normal command persistence, placeholder mapping, invalid input
  rejection, and preservation of existing settings with sandboxed process-global state.
- `src/cmd/init/index.ts` — construct the settings tool with `getCwd()` and pass it into the isolated Init Agent turn.
- `src/cmd/init/index.test.ts` — retain the existing Init command contract and cover Custom Tool construction failures.
- `src/cmd/init/init-verification-confirmation.integration.test.ts` — drive the real isolated Init Agent, structured
  interaction, settings tool, artifact gate, and Init-state transition as one user-visible flow.
- `src/shared/session/subagent-definitions.test.ts` — update the Init Agent contract tests for its new interactive
  status, declared tools, prompt rules, and user-authority behavior.
- `docs/settings.md` — document that Init confirms this project-scoped setting, including the explicit placeholder used
  when verification is not implemented.

## Reuse Opportunities

- `src/tools/user-interview.ts` — reuse structured multiple-choice and text interaction behavior, including its
  automatic **Other** option and free-text follow-up value.
- `src/shared/settings.js` — reuse `setCustomSetting` so writes stay project-scoped, locked, JSONC-compatible, and
  visible to the active settings manager.
- `src/shared/session/session.js` — reuse declarative Custom Tool wiring for `user_interview`; pass the Init-only tool
  through the existing `runIsolatedAgent(..., { customTools })` path.
- `src/cmd/testing/runtime-command-fixture.ts` — reuse isolated Project and home fixtures for Init integration coverage.
- `src/testing/process-global-lock.js` — protect tests that change `HOME` or the current working directory.

## Implementation Steps

- [ ] `src/tools/init-verification-command.ts` exports `createInitVerificationCommandOperation`, whose tool interface
      accepts exactly one resolved outcome: a non-empty confirmed shell command or `verificationNotImplemented: true`.
      It rejects missing, contradictory, or blank input; maps the latter outcome to
      `echo "verification not implemented yet"`; persists only `verification_command` through
      `setCustomSetting(..., "project", projectRoot)` while retaining all unrelated settings; and exposes the saved
      value through `getConfirmedCommand()` only after that write completes.
- [ ] `runInitCommand` passes the operation's tool, bound to the current Project root, through the existing
      isolated-Agent `customTools` path and requires its success receipt before `requireProjectInitArtifact()` and
      `recordInitDone()`. The tool writes `<project>/.wld/settings.json`, including primary-checkout resolution already
      owned by the settings layer, and never writes this Project fact to `~/.wld/settings.json`.
- [ ] The Init Agent first inspects existing project settings, package-manager scripts, task/build files, continuous
      integration configuration, and project documentation. It then uses `user_interview` to show one or more credible
      verification commands plus **No verification command**; the interaction's built-in **Other** path accepts a user
      command or explanation.
- [ ] The Init Agent treats an existing `verification_command` as the leading candidate but still asks for confirmation.
      It saves only a user-confirmed result, asks a focused follow-up when **Other** gives an explanation without a
      usable command, and stops without claiming Init completion when the user cancels or does not resolve the choice.
- [ ] After persistence, the Init Agent stores only the confirmed verification fact in project Memory and continues its
      existing domain-language work. It does not run a guessed command, infer success from repository evidence, or
      replace the exact no-verification placeholder with a silent success command.
- [ ] Init prompt and registry tests prove that the effective Init Agent has `user_interview` and
      `init_save_verification_command`, contains the candidate/Other/no-verification/cancellation rules, and now carries
      the interactive user-authority policy without changing non-interactive subagent policy.
- [ ] Tool tests and `init-verification-confirmation.integration.test.ts` use sandboxed `HOME` and Project roots to
      cover normal commands, multiple candidates, **Other** free text, the exact no-verification placeholder, existing
      JSONC/settings preservation, invalid tool arguments, cancellation without a write or completed Init state, and no
      global settings mutation. The integration case named
      `init confirms and saves verification through the real
      interaction flow` drives the real isolated Init Agent
      and interaction adapter rather than calling only the persistence tool.
- [ ] `docs/settings.md` states that `verification_command` is project-scoped, Init confirms it from repository
      evidence, and selecting no implemented verification saves `echo "verification not implemented yet"` as an explicit
      placeholder.

## Approval Confirmation

No Work Records are superseded by this Plan.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/tools/init-verification-command.test.ts src/cmd/init/index.test.ts src/cmd/init/init-verification-confirmation.integration.test.ts src/shared/session/subagent-definitions.test.ts`
- Automated: `deno task seams:check`
- Automated: `deno task ci`
- Expected: a confirmed custom command appears only in the fixture Project's `.wld/settings.json`, with existing
  settings retained.
- Expected: **No verification command** writes the exact shell command `echo "verification not implemented yet"`.
- Expected: canceled or unresolved confirmation writes no new command and does not mark Init complete.
- Expected: the normal Init completion path still writes and verifies `docs/domain-language.md`, records Init state, and
  emits the existing completion message.

## Edge Cases & Considerations

- Candidate quality: prefer commands explicitly named by repository scripts, continuous integration, or current docs;
  show multiple choices when evidence conflicts instead of combining commands speculatively.
- Existing configuration: preserve it as the recommended candidate and preserve unrelated JSONC keys, but require user
  confirmation before treating it as the Init result.
- **Other** explanations: do not save prose as a shell command. Ask one follow-up that resolves to a command or the
  explicit no-verification outcome.
- Cancellation and tool failure: the missing success receipt makes `runInitCommand` fail before Init completion, even if
  `docs/domain-language.md` already exists. Do not write project Memory for an unconfirmed command.
- Command safety: Init records the command but does not execute it. Later Mechanical Validation remains the execution
  owner.
- Placeholder semantics: the placeholder exits successfully but prints that verification is absent. This behavior is an
  explicit user decision from the request, not evidence that the Project has working verification.
