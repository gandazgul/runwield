---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Convert Doc Writer from a standalone Agent to a Documentation Skill. This involves deleting the agent definition, creating the new skill, updating other agents (Engineer/Operator) to use said skill, and cleaning up references in constants, docs, and settings."
affectedPaths:
    - "src/agent-definitions/doc-writer.md"
    - "src/skills/documentation/SKILL.md"
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/operator.md"
    - "src/constants.js"
    - "docs/index.md"
    - "docs/settings.md"
createdAt: "2026-06-21T04:27:50Z"
updatedAt: "2026-06-21T04:50:24.137Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-21T04:47:50.733Z"
verifiedAt: "2026-06-21T04:50:24.137Z"
routingIntent: "FEATURE"
---

# Convert Doc Writer to Documentation Skill

## Context

The user decided that documentation work in Harns should no longer be modeled as a standalone Doc Writer Agent. The old
PROJECT DAG/doc-writer task model is deprecated, and documentation is better represented as a reusable skill that
writable Agents can load when a FEATURE step or direct user request includes documentation updates.

A prior Ideation pass already updated `CONTEXT.md` to define **Skill** and **Documentation Skill** instead of **Doc
Writer**. Preserve that direction and include the file in final verification, but do not reintroduce Doc Writer as a
domain term.

## Objective

Replace the bundled `doc-writer` Agent Definition with a bundled `documentation` Skill, update Engineer and Operator
instructions to use that skill for docs work, and clean active source/docs references so Harns no longer advertises or
schedules `doc-writer` as a first-class Agent.

## Approach

Use `documentation` as the skill name because it matches the new domain term **Documentation Skill** and reads naturally
in the generated Skills list. Lift the durable documentation-writing guidance from `src/agent-definitions/doc-writer.md`
into `src/skills/documentation/SKILL.md`, but remove agent-only concerns such as `task_completed`, return-to-router
behavior, and PROJECT DAG scope locking.

Delete `src/agent-definitions/doc-writer.md` rather than keeping a compatibility shim. Since the remaining legacy task
scheduler would fail at runtime if it tried to launch a removed `doc-writer` Agent, also remove `AGENTS.DOC_WRITER` and
update the legacy task-assignee allowlist/prompt documentation to use only existing Agents. Documentation work in any
remaining task-slicing language should be described as part of Engineer work, with a note to use the Documentation Skill
when docs are required.

## Files to Modify

- `src/agent-definitions/doc-writer.md` — delete the first-class Agent Definition.
- `src/skills/documentation/SKILL.md` — add the new bundled Documentation Skill with concise front matter and workflow
  guidance for Markdown documentation updates.
- `src/agent-definitions/engineer.md` — instruct Engineer to load/use the Documentation Skill when a FEATURE plan step
  includes documentation updates.
- `src/agent-definitions/operator.md` — instruct Operator to load/use the Documentation Skill for direct/small
  documentation requests.
- `src/agent-definitions/architect.md` — remove the stale engineer/tester/doc-writer fleet language.
- `src/agent-definitions/workflow-prompts/legacy-task-slicer-prompt.md` — remove `doc-writer` as an assignable role;
  route doc work into Engineer slices and mention the Documentation Skill.
- `src/agent-definitions/document-formats/slicer-tasks-format.md` — update the legacy task format examples/rules to
  exclude `doc-writer` assignees.
- `src/constants.js` — remove `DOC_WRITER` from `AGENTS` and its JSDoc object shape.
- `src/shared/workflow/task-scheduling.js` — remove `AGENTS.DOC_WRITER` from `PROJECT_TASK_ASSIGNEES` and update the
  validation error text.
- `src/shared/workflow/workflow.test.js` — update legacy task-validation tests that currently assert `doc-writer` is
  valid.
- `README.md` — remove Doc Writer from the role-scoped execution description and Agent table; mention documentation as
  Skill-guided work where useful.
- `docs/index.md` — remove `doc-writer` from the user-selectable bundled Agent list and mention documentation as a Skill
  if appropriate.
- `docs/settings.md` — remove `doc-writer` from bundled Agent model override examples/lists; keep the list aligned with
  existing bundled Agent Definition files.
- `CONTEXT.md` — preserve/verify the already-applied Doc Writer → Skill/Documentation Skill terminology update.

## Reuse Opportunities

- `src/agent-definitions/doc-writer.md` — reuse the source/audience discovery, Markdown-only, style-matching,
  accuracy-review, and multi-item completion guidance in the new skill.
- `src/skills/write-a-skill/SKILL.md` — follow the established bundled skill structure and description guidance.
- `src/shared/session/session.js:listSkills` — no implementation change should be needed; adding
  `src/skills/documentation/SKILL.md` should make the skill discoverable automatically.
- `src/shared/session/agents.js:listAgentDefNames` — no implementation change should be needed; deleting the agent
  definition removes it from dynamic Agent listings.

## Implementation Steps

- [ ] Step 1: Create `src/skills/documentation/SKILL.md` with front matter like `name: documentation` and a
      trigger-focused description: use when creating/updating Markdown docs, READMEs, API docs, user guides, ADR-like
      docs, or when a plan step asks for documentation.
- [ ] Step 2: Port the useful Doc Writer guidance into the skill: discover source and audience, match existing docs
      style, only write `.md` files, verify examples/paths/API references against source, avoid guessing, and confirm
      all requested docs/sections were updated.
- [ ] Step 3: Delete `src/agent-definitions/doc-writer.md`.
- [ ] Step 4: Add short instructions to `src/agent-definitions/engineer.md` and `src/agent-definitions/operator.md`
      telling them to load/use the `documentation` skill before doing requested documentation updates. For Engineer,
      this applies when a FEATURE plan step includes docs; for Operator, this applies to direct small docs requests.
- [ ] Step 5: Remove active `doc-writer` Agent references from `src/agent-definitions/architect.md`,
      `src/agent-definitions/workflow-prompts/legacy-task-slicer-prompt.md`, and
      `src/agent-definitions/document-formats/slicer-tasks-format.md`. Keep the legacy DAG machinery understandable, but
      ensure it no longer instructs Slicer to assign a removed Agent.
- [ ] Step 6: Remove `DOC_WRITER` from `AGENTS` in `src/constants.js`, including the JSDoc object type.
- [ ] Step 7: Update `src/shared/workflow/task-scheduling.js` so `PROJECT_TASK_ASSIGNEES` includes only Agents that
      still exist (`engineer`, `tester`), and update the validation error text.
- [ ] Step 8: Update tests in `src/shared/workflow/workflow.test.js` that currently accept `doc-writer`; either convert
      the valid example to engineer/tester-only or add an explicit rejection assertion for `doc-writer` if useful.
- [ ] Step 9: Update `README.md`, `docs/index.md`, and `docs/settings.md` so user-facing bundled Agent lists and role
      descriptions no longer mention `doc-writer`; optionally add concise notes that documentation guidance is available
      as the `documentation` Skill.
- [ ] Step 10: Run a final search for `Doc Writer`/`doc-writer` in active source/docs. Leave historical archived plans
      and completed PRDs alone unless they are active user-facing documentation, but ensure no active source, bundled
      Agent Definition, workflow prompt, README section, or settings doc advertises `doc-writer` as usable.
- [ ] Step 11: Review `CONTEXT.md` and preserve the already-applied **Skill**/**Documentation Skill** terminology;
      adjust only if formatting/wording conflicts with project style.

## Verification Plan

- Automated: run `deno task ci` from the repository root (the CI task configured in `deno.json`).
- Automated: run targeted tests if needed while iterating, especially
  `deno test -A src/shared/workflow/workflow.test.js` or `deno task test --filter task` if supported by the local test
  runner.
- Automated/search: run `grep -R "doc-writer" src docs README.md deno.json` (or repo equivalent respecting ignored
  files) and confirm remaining matches are only historical archived plans/PRDs or intentionally retained compatibility
  notes.
- Manual: run or inspect `hns agent` behavior if convenient and confirm `doc-writer` is no longer listed after deleting
  the Agent Definition.
- Manual: confirm the generated Skills list would include `documentation` via existing `listSkills` behavior or by
  running the relevant command/test if available.
- Expected result: `doc-writer` is no longer a bundled Agent, `documentation` is a bundled Skill, Engineer/Operator have
  explicit instructions to use it, and legacy task validation cannot schedule a missing Doc Writer Agent.

## Edge Cases & Considerations

- Existing archived plans or old external PROJECT plans may still contain `doc-writer` tasks. This change intentionally
  removes support for scheduling that removed Agent; legacy active plans with `doc-writer` should fail validation rather
  than fail later during Agent loading.
- Home/local overrides named `doc-writer` could still exist outside the repo. Deleting the bundled definition only
  removes bundled support; do not add special migration code unless tests reveal an active dependency.
- Keep the Documentation Skill concise. Skills are advertised to every Agent by description, so avoid copying the entire
  Agent prompt verbatim if it adds workflow-only noise.
- Do not modify historical archived plans just to remove old references; they document past work and are not active
  Harns behavior.
- `CONTEXT.md` is already dirty from the prior design pass. Implementation should preserve that decision and avoid
  unrelated context rewrites.
