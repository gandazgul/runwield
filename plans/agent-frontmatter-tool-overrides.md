# Plan: Agent frontmatter-based toolsets + layered overrides

## Context

- Current behavior hardcodes agent toolsets in `src/constants.js` via `TOOLSETS`.
- Agent loading in `src/shared/session.js` currently resolves a **single** directory and loads one file per agent; it
  does not merge layers.
- Current resolution order is `bundled -> project .pi/agents` fallback, which is opposite of the requested layered
  override model.
- Goal: move per-agent tool permissions into agent markdown frontmatter and support layered agent overrides from user
  directories so users can customize tools/prompts without editing bundled files.
- Requested precedence: local project override (`<cwd>/.hns/agents`) > home override (`~/.hns/agents`) > bundled
  defaults.
- Requested prompt merge rule: user prompt appends to bundled prompt by default; if `promptOverride: true`, user prompt
  fully replaces bundled prompt.
- Confirmed: support only `.hns/agents` override directories (no `.pi/agents` compatibility path).

## Decisions confirmed

- Override directories: only `.hns/agents` (no `.pi/agents` compatibility path).
- Override paths:
  - local: `<cwd>/.hns/agents/*.md`
  - home: `~/.hns/agents/*.md`
- Precedence: local > home > bundled.
- `tools` merge semantics: full replacement by higher-priority layer (no union).
- Prompt merge semantics:
  - default: append higher-priority prompt bodies to lower-priority prompt body
  - if `promptOverride: true` at a layer: discard accumulated lower-layer prompt and start from that layer’s prompt

## Approach

- Replace single-directory agent resolution with per-agent layered resolution over three files (if present):
  1. bundled `src/agent-definitions/<agent>.md`
  2. `~/.hns/agents/<agent>.md`
  3. `<cwd>/.hns/agents/<agent>.md`
- Parse each layer’s frontmatter/body, then merge in precedence order:
  - scalar attrs (`name`, `model`, `description`, etc.): later layer overrides earlier layer
  - `tools`: later layer fully replaces earlier layer
  - prompt body: append by default; reset replacement when layer has `promptOverride: true`
- Keep `CORE_SYSTEM_PROMPT` prepended to the final merged prompt body.
- Make `runAgentSession` derive allowed tools from merged agent definition by default so callsites no longer rely on
  `TOOLSETS`.
- Keep custom tools (`triage_report`, `plan_written`) passed explicitly at callsites, appended alongside frontmatter
  tools.

## Files to modify

- `src/shared/session.js`
  - replace `resolveAgentDefsDir`/single-file loading with layered loading utilities
  - extend `AgentDef` to include `tools`
  - make `runAgentSession` use merged `agentDef.tools` by default
- `src/shared/agents.js`
  - list agents from merged name set across bundled/home/local layers
  - show merged metadata (`displayName`, `description`, `model`)
- `src/shared/direct-agent.js`
  - remove `TOOLSETS.OPERATOR`; rely on agent-defined tools
- `src/cmd/router/index.js`
  - remove `TOOLSETS.*` usage; rely on per-agent frontmatter tools
- `src/cmd/resume/index.js`
  - same as router for planning invocations
- `src/cmd/sleep/index.js`
  - rely on operator frontmatter tools
- `src/shared/workflow.js`
  - remove engineer/doc-writer hardcoded toolset selection
- `src/constants.js`
  - remove `TOOLSETS` and `MEMORY_TOOLSET` exports if fully unused after refactor
- `src/agent-definitions/*.md`
  - add `tools` arrays in frontmatter for bundled defaults
- `README.md`
  - update agent prompt/tool configuration docs to `.hns/agents` layered overrides

## Reuse

- Existing frontmatter parsing with `extractYaml`/`hasFrontMatter` in:
  - `src/shared/session.js`
  - `src/shared/agents.js`
- Existing `CORE_SYSTEM_PROMPT` composition in `src/shared/session.js`.
- Existing centralized invocation boundary: `runAgentSession(...)` already used by router/resume/workflow/sleep/direct
  agent.
- Existing custom tool injection pattern (`customTools`) in router/review loops remains unchanged.

## Steps

- [ ] In `src/shared/session.js`, add layered path constants/helpers for:
  - bundled defs dir
  - `~/.hns/agents`
  - `<cwd>/.hns/agents`
- [ ] Implement `loadMergedAgentDef(agentName)` that reads up to three markdown files and merges attrs/body with
      confirmed precedence and override rules.
- [ ] Update `runAgentSession` signature/logic so `toolNames` is optional and defaults to merged `agentDef.tools`.
- [ ] Update callsites (`router`, `resume`, `sleep`, `workflow`, `direct-agent`) to stop passing `TOOLSETS.*` and rely
      on agent tools.
- [ ] Add `tools` frontmatter to bundled definitions (`router`, `operator`, `planner`, `architect`, `engineer`,
      `tester`, `doc-writer`) matching current effective permissions.
- [ ] Refactor `listAvailableAgents` to build merged agent list across layered directories, including user-only agents
      if provided.
- [ ] Remove dead constants (`TOOLSETS`, `MEMORY_TOOLSET`) and adjust imports.
- [ ] Update README sections that still reference `.pi/agents` to `.hns/agents`, including precedence and
      `promptOverride`/`tools` override semantics.

## Verification

- Functional flow smoke tests:
  - Router triage path works with router frontmatter tools.
  - QUICK_FIX path works with operator frontmatter tools.
  - FEATURE/PROJECT planning loops still invoke custom tools (`triage_report`, `plan_written`) correctly.
  - Resume flow and sleep flow still run end-to-end.
  - `/agent <name>` direct mode uses that agent’s frontmatter tools.
- Layered override checks (create temporary agent files in `~/.hns/agents` and `<cwd>/.hns/agents`):
  - Home override alone changes model/description/tools.
  - Local override supersedes home values.
  - `tools` in higher layer fully replaces lower-layer tools.
  - Prompt appends by default across layers.
  - `promptOverride: true` discards lower-layer prompt content.
- Agent discovery checks:
  - `hns --agent` lists merged metadata.
  - user-only agent files in `.hns/agents` appear in listing and can be invoked.
- Cleanup/regression:
  - no remaining `TOOLSETS` imports/references.
  - `deno run ci` passes.
