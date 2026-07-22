---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add Markdown-restricted write_docs and edit_docs Custom Tools so Guide can explicitly preserve conversational explanations as ordinary documentation without gaining general file mutation access."
affectedPaths:
    - "src/tools/docs-file-tools.js"
    - "src/tools/__tests__/docs-file-tools.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/session/tool-event-title.test.js"
    - "src/shared/workflow/metrics.js"
    - "src/shared/workflow/metrics.test.js"
    - "src/agent-definitions/guide.md"
    - "src/shared/session/agents.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "README.md"
    - "docs/index.md"
    - "docs/usage.md"
    - "docs/workflows.md"
    - "docs/customization.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-22T09:47:20-04:00"
updatedAt: "2026-07-22T17:32:08.187Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-22T14:00:47.862Z"
verifiedAt: "2026-07-22T17:32:08.187Z"
executionReport: "- Implemented `write_docs` / `edit_docs` Markdown-restricted Custom Tools and auto-wiring; non-`.md` targets are rejected before mutation.\n- Updated Guide policy/tools and docs so Guide can only preserve/update ordinary `.md` docs on explicit follow-up; Router and Operator behavior remain unchanged.\n- Added regression coverage for tool behavior, Guide tool policy, Runtime titles, metrics, and delegated-agent exclusion.\n- Verification passed: `deno test -A src/tools/__tests__/docs-file-tools.test.js`; targeted session/runtime tests; `deno test -A src/tools/__tests__/delegate-agent.test.js`; `deno task ci`.\n- Manual model-backed Guide conversation flows were not run; equivalent tool and policy behavior was covered by automated tests."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
---

# Guide Markdown Document Tools

## Context

Guide is intentionally read-mostly and currently cannot preserve a useful code walkthrough, explanation, or repository
report when the user asks to make that conversation durable. Granting the built-in `write` or `edit` tools would also
let Guide mutate code, configuration, and other non-document files.

The requested capability is a narrow continuity exception, not a Router behavior change or a new documentation workflow.
A conversation already owned by Guide may materialize an ordinary Markdown document only after the user explicitly asks.
Router continues to classify fresh requests under its existing rules, Operator remains unchanged, and Guide still does
not emit Task Completion.

## Objective

Add `write_docs` and `edit_docs` Custom Tools that retain the established built-in write/edit behavior while rejecting
non-`.md` targets before mutation. Expose only these mutation tools to Guide, and update Guide's behavior so it can save
or revise ordinary documentation and reports without gaining general file mutation, Plan, implementation, or workflow
ownership.

## Approach

Create one docs-file tool module with a shared lexical path validator and two small adapters:

- `write_docs` wraps pi-coding-agent's `createWriteToolDefinition`, preserving file creation, parent-directory creation,
  overwrite behavior, cancellation, result shape, and relative/absolute path semantics.
- `edit_docs` wraps RunWield's existing `createEditWithFallbackToolDefinition`, preserving its single exact-replacement
  interface and current-content fallback on edit failure.

Each adapter changes the public name, label, description, prompt guidance, and execution entry point. Before delegating
to the wrapped tool, validate that the final path extension is `.md` case-insensitively. `.markdown`, `.mdx`,
extensionless paths, and every other suffix are rejected with a clear error and no filesystem mutation. Per the user's
decision, do not confine targets to the active Project or add symlink-specific checks; this is a file-type guard that
otherwise matches the existing tools' path semantics.

Auto-wire the adapters in `buildAgentSession()` when their names survive Agent Definition policy, without adding them to
`PROTECTED_TOOL_NAMES`. Keep this wiring Agent-agnostic so the new restricted capability remains configurable through
the established layered Agent Definition system; only bundled Guide names the tools in this feature. This allows
local/home Guide overrides to remove them and future/custom Agent Definitions to opt in deliberately. Keep them out of
Delegated Agent Session allowlists so Guide cannot transfer the capability to a delegated read session.

Revise Guide's Agent Definition and attention nudge around an explicit-preservation rule: answer normally without
writing; when the user asks to preserve or update the current explanation as an ordinary document/report, load the
Documentation Skill, establish the destination when unclear, and use the docs-only tools. Continue to exclude code,
configuration, Plans, PRDs, ADRs, `CONTEXT.md`, Work Records, Agent Definitions, Skills, prompt templates, and other
workflow-owned artifacts even though many use `.md` paths. Requests for those artifacts or broader implementation still
return to Router.

## Files to Modify

- `src/tools/docs-file-tools.js` — add the shared `.md` path validator and the `write_docs`/`edit_docs` adapters.
- `src/tools/__tests__/docs-file-tools.test.js` — cover adapter metadata, allowed writes/edits, rejected suffixes,
  relative and absolute paths, and no-mutation failures.
- `src/shared/session/session.js` — auto-wire requested docs tools into Agent Sessions and expose their definitions to
  prompt/context projection through `finalCustomTools`.
- `src/shared/session/tool-event-title.js` — format both tools with target paths and classify them as edit-kind Runtime
  events.
- `src/shared/session/tool-event-title.test.js` — verify stable names, path-bearing titles, and edit kinds.
- `src/shared/workflow/metrics.js` — classify `write_docs` as write sub-usage and `edit_docs` as edit sub-usage instead
  of generic Custom Tool activity.
- `src/shared/workflow/metrics.test.js` — verify the new metric classifications through the existing metrics seam.
- `src/agent-definitions/guide.md` — grant the two tools and replace the absolute read-only prohibition with the narrow,
  explicit ordinary-document preservation policy.
- `src/shared/session/agents.js` — update Guide's periodic attention nudge to reinforce docs-only continuity without
  broad materialization.
- `src/shared/session/session-prompt.test.js` — update the expected Guide nudge.
- `src/shared/session/__tests__/session-tools-policy.test.js` — assert Guide receives the new tools, still lacks generic
  mutation/completion tools, gets concrete auto-wired definitions, and retains the explicit-preservation and
  workflow-owned-artifact exclusions in its assembled policy.
- `README.md` — describe Guide's user-requested Markdown preservation exception in the Agent overview.
- `docs/index.md` — include Guide in the Documentation Skill guidance without presenting it as a general writer.
- `docs/usage.md` — document the in-session Guide follow-up behavior while preserving existing Router usage.
- `docs/workflows.md` — refine `INQUIRY` from strictly non-executable to answer-focused with an explicit ordinary-doc
  preservation exception.
- `docs/customization.md` — clarify that Skill availability and file-mutation capability are distinct, and that Guide's
  docs-only tools support the Documentation Skill.
- `docs/prd/runwield-core-prd.md` — update the living current-state Guide/tool-policy description with the restricted
  Custom Tool behavior; do not change Routing Intent dispatch.

## Reuse Opportunities

- `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js::createWriteToolDefinition` — delegate normal
  write behavior instead of reimplementing directory creation, mutation queuing, cancellation, and results.
- `src/tools/edit-with-fallback.js::createEditWithFallbackToolDefinition` — preserve RunWield's established single-edit
  schema and useful failure response.
- `src/shared/session/session.js::buildAgentSession` — follow the existing declarative Custom Tool auto-wiring pattern
  used by `multi_file_edit`, Work Record tools, and workflow tools.
- `src/shared/session/session.js::assembleFinalSystemPromptWithContextProjection` — rely on `finalCustomTools` so the
  new descriptions and schemas appear in Guide's tool projection without adding fake built-in definitions.
- `src/shared/session/tool-event-title.js::getFilePathForTool` and `describeRuntimeTool` — extend the central Runtime
  presentation contract rather than formatting the new tools at consumers.
- `src/shared/workflow/metrics.js::classifyToolSubUsage` — extend the existing tool-usage taxonomy.
- Bundled `documentation` Skill — retain its source-verification, repository-voice, focused-edit, and accuracy workflow;
  Guide adds stricter artifact ownership on top of that general Skill.

## Implementation Steps

- [ ] Step 1: Add `src/tools/docs-file-tools.js` with a shared final-extension check and factories for `write_docs` and
      `edit_docs`; adapt metadata and delegate successful calls to the existing write/edit definitions without changing
      their parameter shapes or results.
- [ ] Step 2: Add focused tool tests proving `.md` is accepted case-insensitively for relative and absolute targets;
      writes create/overwrite Markdown and parent directories; edits replace one exact block; `.markdown`, `.mdx`,
      `.txt`, and extensionless targets fail before creating or changing a file.
- [ ] Step 3: Auto-wire each requested tool in `buildAgentSession()` only when it is in the effective Agent tool set and
      no same-named runtime Custom Tool was supplied. Keep the factory wiring reusable for layered/custom Agent
      Definitions, but add the names only to bundled Guide. Do not add either name to protected tools or delegated
      read/write allowlists.
- [ ] Step 4: Extend Runtime event title/kind handling and workflow metric sub-usage classification for both tool names,
      with regression tests for their path summaries and write/edit categories.
- [ ] Step 5: Add `write_docs` and `edit_docs` to Guide front matter. Rewrite Guide's scope rules so ordinary Markdown
      creation/editing happens only on explicit user request, after loading the Documentation Skill, with target-path
      clarification when needed and focused edits preferred over rewrites.
- [ ] Step 6: Keep Guide outside implementation and artifact-owning workflows: explicitly deny generic source/config
      mutation and Plan, PRD, ADR, domain-context, Work Record, Agent Definition, Skill, or prompt-template creation or
      editing. Preserve normal conversational completion and `return_to_router` for broader requests.
- [ ] Step 7: Update Guide's attention nudge and session policy tests to reflect “read-mostly plus explicit docs
      preservation”; prove generic `write`, `edit`, `multi_file_edit`, `task_completed`, `plan_written`, and
      `triage_report` remain unavailable, and assert the assembled Guide policy names both the explicit-user-request
      condition and workflow-owned Markdown exclusions.
- [ ] Step 8: Update active user documentation and the living Core PRD to explain the continuity use case, docs-only
      capability, explicit-user-request requirement, unchanged Router dispatch, and unchanged Operator policy.
- [ ] Step 9: Run the full repository quality gate and repair every failure.

## Verification Plan

- Automated: run `deno test -A src/tools/__tests__/docs-file-tools.test.js` while iterating.
- Automated: run targeted session/runtime tests covering `src/shared/session/__tests__/session-tools-policy.test.js`,
  `src/shared/session/session-prompt.test.js`, `src/shared/session/tool-event-title.test.js`, and
  `src/shared/workflow/metrics.test.js`.
- Automated: run `deno task ci` from the repository root and fix all failures.
- Manual: start or switch to Guide, ask for a code walkthrough, then ask “save that as `docs/example-walkthrough.md`”;
  confirm Guide loads the Documentation Skill, writes the file, reports the path conversationally, and does not call
  `task_completed` or return to Router.
- Manual: ask Guide to update one exact section of an existing `.md` file; confirm `edit_docs` preserves the rest of the
  file and exposes the normal edit result/diff behavior.
- Manual: ask Guide to save the same content to `.txt`, `.markdown`, and `.mdx`; confirm each tool rejects the path and
  leaves the filesystem unchanged.
- Manual: ask Guide to save without naming a destination; confirm it asks for or proposes a clear `.md` target before
  writing rather than silently choosing a workflow-owned artifact.
- Manual: ask Guide to modify source code, a Plan, PRD, ADR, `CONTEXT.md`, or Agent Definition; confirm it does not use
  the docs tools as an extension loophole and returns the broader request to Router.
- Expected: Router classification and Operator capabilities are unchanged; bundled Guide alone gains two removable,
  Markdown-restricted Custom Tools, while layered/custom Agent Definitions may opt in through normal tool policy.

## Edge Cases & Considerations

- The `.md` restriction is intentionally lexical and preserves native absolute-path and symlink behavior. It is not a
  filesystem sandbox; Guide's ordinary-document/artifact ownership restrictions remain behavioral policy, and its
  discovery-only `bash` rule remains necessary.
- Existing `.markdown` and `.mdx` repositories are outside this feature by explicit decision. Supporting additional
  formats later should be a deliberate validator-policy change with tests.
- `write_docs` can overwrite an existing `.md` file because it wraps `write`; Guide should prefer `edit_docs` for
  focused updates and reserve full writes for new documents or user-approved rewrites.
- Local/home Agent Definition overrides may remove the new tools because mutation capabilities are not protected. A
  runtime Custom Tool with the same name continues to take precedence under the existing auto-wiring convention.
- Guide is the only bundled user-facing read-only Agent suited to this grant. Router remains Triage-only, Recorder and
  Reviewer remain workflow-scoped, and Delegated Agent Sessions do not receive these tools.
- `CONTEXT.md` currently defines Guide as unable to materialize documentation. This Plan records the user-approved new
  behavior but intentionally does not modify the domain glossary. After implementation, Ideator or Init should reconcile
  the canonical Guide definition and relationships without broadening Guide beyond this explicit ordinary-doc
  preservation exception.
