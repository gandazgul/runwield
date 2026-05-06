# Agent Tools Strict Frontmatter Plan

## Context

- User requirement: agents must only have tools explicitly allowed by frontmatter policy.
- Current behavior in `src/shared/session/session.js` always appends a large internal tool set via `addInternalTools`,
  which grants extra tools even when not in frontmatter.
- Clarified rule:
  - For each agent, **protected tools** are the intersection of:
    1. that agent’s bundled (`src/agent-definitions/<agent>.md`) frontmatter tools, and
    2. the protected tool-name list provided by user.
  - Overrides in `~/.hns/agents` and `./.hns/agents` can add/remove tools, but cannot remove protected tools for that
    agent.
  - User-added/extension tools are allowed when explicitly listed in effective frontmatter (and available at runtime).

## Approach

- Replace unconditional internal tool injection with policy-driven resolution.
- In `loadAgentDef(agentName)`:
  - Track bundled frontmatter tools separately from merged override tools.
  - Compute `protectedToolsForAgent = bundledTools ∩ PROTECTED_TOOL_NAMES`.
  - Return effective tools as `mergedTools ∪ protectedToolsForAgent` (deduped, stable order).
- In `runAgentSession(...)`:
  - Stop calling `addInternalTools`.
  - Build final tool names from:
    - policy-resolved agent tools (`agentDef.tools`),
    - runtime `toolNames` filtered to policy-allowed set (cannot bypass policy),
    - runtime `customTools` names (user-provided/dynamic tools).
- Keep custom-tool auto-wiring for `switch_agent`, `plan_written`, `triage_report`, `user_interview`, but only when
  those names are in the final allowed set.
- Keep extension-built tools (mnemosyne/cymbal) available only when included by the final tool list; no implicit
  granting.
- Add tests focused on the exact override/protection semantics.

## Files to modify

- `src/tools/registry.js` (new: export `PROTECTED_TOOL_NAMES` for centralized tool policy constants)
- `src/shared/session/session.js` (import protected names, enforce tool policy, remove implicit internal additions)
- `src/shared/session/__tests__/session-tools-policy_test.js` (new targeted tests for load/merge policy)
- `src/tools/__tests__/switch-agent_test.js` (only if model-loading expectations need minor adaptation)

## Reuse

- Reuse layered merge logic in `loadAgentDef` for scalar/prompt/tool override semantics.
- Reuse `normalizeToolNames` for robust deduped tool parsing.
- Reuse existing `runAgentSession` tool assembly and custom-tool auto-wiring blocks (`switch_agent`, `plan_written`,
  `triage_report`, `user_interview`).
- Reuse existing bundled definitions under `src/agent-definitions/*.md` as source of per-agent protected baseline.

## Steps

- [ ] Add `src/tools/registry.js` exporting `PROTECTED_TOOL_NAMES` (exact list from requirement) for future
      extensibility.
- [ ] Import `PROTECTED_TOOL_NAMES` into `session.js` (avoid duplicating the list there).
- [ ] Refactor `loadAgentDef` to keep both bundled-tools snapshot and merged-tools result while traversing layers.
- [ ] Compute per-agent protected set (`bundled ∩ protected list`) and union it into final returned `tools`.
- [ ] Remove `addInternalTools` from `loadAgentDef` return path and from `runAgentSession` runtime selection.
- [ ] In `runAgentSession`, enforce policy for `toolNames` override by filtering against `agentDef.tools`; then union
      runtime `customTools` names.
- [ ] Preserve custom-tool auto-wiring gates based on final tool list.
- [ ] Add tests:
  - [ ] Agent override example: bundled router tools + local `tools: [read]` yields `read + protected(router)` only.
  - [ ] Non-protected bundled tool (e.g., `bash`) is removable by override.
  - [ ] Runtime `toolNames` cannot re-enable removed, non-protected tools.
  - [ ] Runtime `customTools` names are still included.

## Verification

- Run new targeted tests for session tool policy behavior.
- Run existing related tests (including `switch-agent`).
- Run full CI (`deno run ci`) and confirm pass.
- Manual scenario check:
  - bundled router includes `read, grep, ... protected...`
  - local router override contains only `read`
  - final router tools are exactly `read + (bundled ∩ protected list)` (no extra non-protected tools).
