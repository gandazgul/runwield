---
planId: "daa36ef2-5d66-4794-a61a-562d9253817c"
classification: "FEATURE"
complexity: "LOW"
summary: "Implement the `code_batch` Custom Tool in the Cymbal extension to allow batching of `show` and `outline` operations, reducing LLM roundtrips. This includes schema definition, execution logic with caps/error isolation, and updating agent toolsets."
affectedPaths:
    - "src/extensions/cymbal/index.js"
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/router.md"
frontend: false
createdAt: "2026-07-04T13:04:10-04:00"
updatedAt: "2026-07-17T04:41:52.290Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-04T17:48:58.177Z"
verifiedAt: "2026-07-04T17:54:23.389Z"
workRecord:
    status: "generated"
    recordId: "d1d9245b-971a-41ac-83d2-c0813b074583"
    path: "docs/work-records/2026-07-17-added-batched-cymbal-show-and-outline-tooling.md"
    lastAttemptAt: "2026-07-17T04:41:42.118Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-04T17:54:20.676Z"
archivedAt: "2026-07-05T04:13:26.531Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/code-batch-cymbal-tool.md"
routingIntent: "FEATURE"
sessionName: "implement code_batch tool"
---

# Add Code-Batch Cymbal Tool

## Context

RunWield agents frequently spend extra turns calling `code_show` and `code_outline` one target at a time after they have
already identified the relevant symbols or files. The resolved product decision is to keep `cymbal` as raw primitive CLI
commands and add LLM roundtrip-saving ergonomics in RunWield wrapper tooling instead.

This plan implements the first conservative batch tool: `code_batch` supports only deterministic, bounded Cymbal reads:
`show` and `outline`. `search` / `multi_search` is explicitly deferred because search is exploratory and can explode
context. `project_context_snapshot` is also out of scope because it is too project-specific and brittle when init is
skipped.

## Objective

Add a `code_batch` Custom Tool that lets agents request several `show` and/or `outline` operations in one tool call
while preserving clear output, strict caps, and per-operation error isolation.

Target interface:

```js
{
    operations: [
        { op: "show", target: "buildAgentSession" },
        { op: "outline", file: "src/extensions/cymbal/index.js" },
    ],
}
```

## Approach

Implement `code_batch` inside the existing Cymbal extension module as a RunWield adapter over current `cymbal show` and
`cymbal outline` calls. Do not add new Cymbal CLI behavior.

Use hard limits to keep the tool predictable:

- Maximum operations per call: 5.
- Maximum total returned text: 50,000 characters, with a visible truncation marker.
- Only two operation kinds in v1: `show` and `outline`.
- Execute operations sequentially and render each result in its own labeled section.
- Treat individual Cymbal failures as section output so one bad target does not prevent later operations from running.
- Use a top-level tool error only for invalid `code_batch` arguments or internal validation failures.

## Files to Modify

- `src/extensions/cymbal/index.js` — add `codeBatchToolDef`, batch operation schema, helper formatting/truncation logic,
  and runtime registration/execution.
- `src/extensions/cymbal/index.test.js` — cover registration, command mapping, operation ordering, per-operation errors,
  output truncation, and operation-count validation.
- `src/shared/session/session.js` — import `codeBatchToolDef` and include it in `assembleFinalSystemPrompt()` extension
  tool descriptions so prompt rendering knows the tool description.
- `src/shared/session/session-subscribers.test.js` — add UI header coverage for `code_batch`; use a compact header such
  as `2 operations` rather than trying to list every target in the tool chrome.
- `src/shared/session/__tests__/session-tools-policy.test.js` — include `code_batch` in protected code tool expectations
  where appropriate.
- `src/tools/registry.js` — add `code_batch` to `PROTECTED_TOOL_NAMES` with the other codebase exploration tools.
- `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md` — document when to prefer `code_batch` for multiple already-known
  `show`/`outline` targets.
- `src/agent-definitions/*.md` and workflow prompt frontmatter listed above — add `code_batch` alongside `code_show` and
  `code_outline` for agents/pseudo-agents that already have both tools.

## Reuse Opportunities

- `src/extensions/cymbal/index.js` — reuse the existing `runCymbal(...args)` helper and `pi.registerTool()` pattern.
- `src/extensions/cymbal/index.test.js` — reuse the existing fake `ExtensionAPI`, `executeTool()`, and `firstText()`
  test helpers.
- `src/shared/session/session.js` — follow the existing `extensionTools` list pattern used by `code_show` and
  `code_outline`.
- `src/shared/session/session-subscribers.test.js` — extend the existing table-driven tool header test.

## Implementation Steps

- [ ] In `src/extensions/cymbal/index.js`, define constants such as `MAX_CODE_BATCH_OPERATIONS = 5` and
      `MAX_CODE_BATCH_OUTPUT_CHARS = 50_000`.
- [ ] Add a TypeBox schema for `code_batch` with `operations` as an array of discriminated operation objects:
      `{ op: "show", target: string }` or `{ op: "outline", file: string }`.
- [ ] Export `codeBatchToolDef` with a concise description and prompt snippet that says it batches multiple known
      `show`/`outline` reads and does not support search.
- [ ] Add helper functions to convert each operation to Cymbal args, label sections, normalize empty output to
      `No results found.`, and truncate the combined output with an explicit marker.
- [ ] Register `code_batch` in `cymbalExtension(pi)` using
      `pi.registerTool({ ...codeBatchToolDef, async execute(...) })`.
- [ ] In `execute`, validate the operation count defensively, run each operation sequentially through `runCymbal`, and
      return one text block containing labeled sections plus `details` such as operation count and truncation status.
- [ ] Import `codeBatchToolDef` in `src/shared/session/session.js` and add it to the `extensionTools` list used by
      `assembleFinalSystemPrompt()`.
- [ ] In `attachUiSubscribers()` in `src/shared/session/session.js`, add `code_batch` header formatting based on
      `operations.length` (for example, `2 operations`).
- [ ] Add `code_batch` to `src/tools/registry.js` under codebase exploration protected tools.
- [ ] Add `code_batch` to bundled agent frontmatter for all agents and workflow pseudo-agents that already expose both
      `code_show` and `code_outline`.
- [ ] Update `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md` to advise agents to use `code_batch` when they already know
      multiple symbols/files needing `show` or `outline`, while keeping `code_search` as the first step for unknown
      targets.
- [ ] If Engineer/Operator instructions say `code_show`/`code_outline` are mandatory for export/signature checks, adjust
      wording so an equivalent `code_batch` `show`/`outline` operation satisfies the same requirement.
- [ ] Update tests in `src/extensions/cymbal/index.test.js` for the new tool behavior.
- [ ] Update session/tool policy and UI subscriber tests for the new tool name and header formatting.

## Verification Plan

- Automated targeted tests first:
  - `deno test -A src/extensions/cymbal/index.test.js`
  - `deno test -A src/shared/session/session-subscribers.test.js src/shared/session/__tests__/session-tools-policy.test.js`
- Automated full validation:
  - `deno task ci`
- Manual/tool behavior check:
  - Start a local RunWield session after implementation and confirm `code_batch` appears in available tools for an agent
    that has `code_show` and `code_outline`.
  - Exercise a call with one `show` and one `outline`; verify the tool invokes `cymbal show` / `cymbal outline`,
    separates results by operation, and preserves useful output if one target fails.

## Edge Cases & Considerations

- `search` remains out of scope for v1; do not add `multi_search` or batch `code_search` behavior in this feature.
- Per-operation Cymbal errors should not mark the whole tool call as failed unless the batch arguments themselves are
  invalid.
- Keep output deterministic and readable: include operation index, operation kind, and target/file in each section.
- Truncation must be obvious to the agent so it can follow up with narrower `code_show`/`code_outline` calls if needed.
- Preserve pure JavaScript with JSDoc typing; do not introduce TypeScript syntax.
