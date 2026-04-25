---
created: 2026-04-25T21:02:41.314Z
source: plannotator
tags: [plannotator, harness]
---

[[Plannotator Plans]]

---
classification: "PROJECT"
complexity: "HIGH"
summary: "Integrate Mnemosyne as a first-class persistent memory layer across HAR lifecycle (startup/default prompt injection and all router/planning/execution flows), add memory tools (memory_recall, memory_recall_global, memory_store, memory_store_global with core=true support on non-global too), and introduce a new sleep command for memory cleanup/optimization using a built-in Harness prompt. This requires extending session/tool initialization architecture (not just a local quick patch), adding a new command path, and updating CLI/help/docs and flow wiring."
affectedPaths:
- "src/cli.js"
- "src/constants.js"
- "src/cmd/registry.js"
- "src/shared/session.js"
- "src/cmd/router/index.js"
- "src/cmd/resume/index.js"
- "src/shared/help-text.js"
- "deno.json"
  createdAt: "2026-04-25T21:02:40.652Z"
  updatedAt: "2026-04-25T21:02:40.652Z"
  status: "in_review"
  origin: "external"
---

### Objective

Integrate Mnemosyne as HAR’s first-class memory layer across all agent sessions
(router/planning/execution), expose memory tools (`memory_recall`,
`memory_recall_global`, `memory_store`, `memory_store_global` with `core=true`
support), inject core memories into system prompts by default, and add a new
`sleep` command that runs memory optimization/cleanup using a built-in Harness
prompt (no external prompt file dependency).

### Vertical Slice Findings

- `har` request flow is: `src/cli.js` → `src/cmd/registry.js` → command handlers
  (`router`/`resume`) → `reviewLoop/executePlan` (`src/shared/workflow.js`) →
  `runSession` (`src/shared/session.js`) → `createAgentSession`.
- `runSession` currently passes explicit `tools` allowlists from `TOOLSETS`; any
  unlisted tool is disabled. So memory tools must be included in toolsets or a
  shared always-on list.
- `runSession` uses `DefaultResourceLoader` but does not currently provide
  extension factories; therefore lifecycle hooks like `session_start` and
  `before_agent_start` are not yet used for Mnemosyne core-memory injection.
- CLI commands currently are `router`, `resume`, `plans`, `help`; there is no
  existing `sleep` command path.
- The provided Mnemosyne extension (`pi-mnemosyne/index.ts`) already implements
  the required behavior (auto-init, core-memory cache, prompt injection, memory
  recall/store tools, global variants, `core` tagging).

### File Impacts

| File                                | Action | Description                                                                                                        |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `src/shared/session.js`             | Modify | Register Mnemosyne extension factory in `DefaultResourceLoader`, ensure all sessions load memory hooks/tools.      |
| `src/extensions/mnemosyne/index.js` | Create | Port/adapt `~/Documents/web/mnemosyne/pi-mnemosyne/index.ts` for HAR runtime use.                                  |
| `src/constants.js`                  | Modify | Add shared memory tool-name list and include memory tools in all relevant toolsets; add `SLEEP` command constant.  |
| `src/cmd/sleep/index.js`            | Create | Implement new `sleep` command: use built-in optimize prompt, run operator session for memory cleanup/organization. |
| `src/cmd/registry.js`               | Modify | Register `sleep` command handler.                                                                                  |
| `src/shared/help-text.js`           | Modify | Add `sleep` command summary/usage/help text.                                                                       |
| `src/cli.js`                        | Modify | Update top-level usage docs comment to include `sleep`.                                                            |
| `src/cmd/router/index.js`           | Modify | Ensure router flow uses updated toolsets (memory tools available by default).                                      |
| `src/cmd/resume/index.js`           | Modify | Ensure resumed planning/execution flows inherit updated toolsets with memory tools.                                |
| `deno.json`                         | Modify | Add any required import/task adjustments for new extension/command wiring (if needed after implementation).        |

### Implementation Steps

- [ ] Step 1: Add `SLEEP` to `COMMAND_NAMES` and define a shared
      `MEMORY_TOOLSET` (`memory_recall`, `memory_recall_global`, `memory_store`,
      `memory_store_global`) in `src/constants.js`; compose all agent toolsets
      with this memory set.
- [ ] Step 2: Create `src/extensions/mnemosyne/index.js` by adapting the
      referenced `pi-mnemosyne/index.ts` (keep behavior for `session_start`,
      `before_agent_start`, core cache invalidation, and all memory tools with
      `core` on non-global/global store).
- [ ] Step 3: Wire Mnemosyne extension into session creation in
      `src/shared/session.js` via
      `DefaultResourceLoader({ extensionFactories: [...] })` so all
      commands/agents get memory lifecycle behavior.
- [ ] Step 4: Add `src/cmd/sleep/index.js` that: (a) uses a built-in sleep
      optimization prompt, (b) validates Mnemosyne availability, (c) invokes
      `runSession` with `agentName: "operator"` and memory-enabled toolset using
      that prompt content.
- [ ] Step 5: Register `sleep` in `src/cmd/registry.js`; update
      `src/shared/help-text.js` and `src/cli.js` usage text to expose the
      command.
- [ ] Step 6: Ensure router/resume/execute-plan paths require no bespoke
      branching and inherit memory automatically through shared toolsets/session
      loader.
- [ ] Step 7: Add graceful error handling UX for missing Mnemosyne binary
      (actionable install/path guidance, no hard crash loops).
- [ ] Step 8: Validate end-to-end flows:
  - `har "..."` (router/feature/project)
  - `har resume <plan>`
  - `har sleep`
  - Verify tool visibility includes the four memory tools.
  - Verify core memories appear in system prompt (smoke test with a stored
    `core` memory).

### Tasks (PROJECT-scale plans)

| Task | Assignee   | Dependencies | Description                                                                                                             |
| ---- | ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | engineer   | —            | Implement Mnemosyne extension module and session wiring (`src/extensions/mnemosyne/index.js`, `src/shared/session.js`). |
| 2    | engineer   | 1            | Add memory toolset/constants and wire command surface (`sleep` command, registry, help, CLI usage).                     |
| 3    | tester     | 1,2          | Execute E2E validation matrix (router/resume/sleep, core-memory injection, missing-binary behavior).                    |
| 4    | doc-writer | 3            | Update user-facing docs/help snippets for memory tools, core vs non-core behavior, and `sleep` usage.                   |

### Edge Cases & Considerations

- HAR currently has no explicit `init` command; Mnemosyne `init` must run
  automatically on each session start (idempotent) to satisfy “from init”
  behavior.
- Tool allowlist semantics are strict; forgetting to include memory tools in any
  toolset silently disables memory for that flow.
- First-time Mnemosyne usage may trigger model setup/download cost; messaging
  should remain clear and non-fatal.
- Sleep uses a built-in prompt; no external prompt file is required.
- Compiled binary behavior must still include the extension code path (avoid
  relying on project-local `.pi/extensions` only).
- Keep `core=true` usage conservative: core memories are always injected and can
  increase prompt size if overused.
