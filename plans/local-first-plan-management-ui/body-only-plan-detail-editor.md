---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add read-first Plan detail pages with rendered markdown and a CodeMirror-style body-only editor that preserves front matter, detects stale saves, and supports browser-local draft recovery."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/ui/workspace/"
    - "deno.json"
    - "deno.lock"
createdAt: "2026-06-24T20:14:08.683Z"
updatedAt: "2026-06-24T20:14:08.683Z"
status: "draft"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "secure-workspace-read-only-board"
---

# Body-Only Plan Detail Editor

## Context

Users need to read and edit Plan bodies in the browser, but workflow-critical front matter must remain controlled by
structured lifecycle and Plan-store APIs. The v1 editor is a CodeMirror-style markdown source editor, not BlockSuite.

## Objective

Add Plan detail pages with rendered markdown, front matter summaries, and explicit body-only editing. Saves must
preserve front matter exactly through Plan-store seams and reject stale writes when the on-disk body changed after the
editor was opened.

## Approach

Add body extraction, hashing/revision, and body-only save helpers to `src/plan-store.js`. Expose detail and save API
routes from the Workspace server. Build a read-first Plan detail page with an Edit action that loads a CodeMirror 6
markdown editor island. Store unsaved drafts in browser-local storage keyed by project/workspace identity plus `planId`,
and use a body hash or revision token for stale-save protection.

## Files to Modify

- `src/plan-store.js` — add body metadata and body-only save helper that preserves front matter and rejects stale saves.
- `src/plan-store.test.js` — cover body save preservation, stale save rejection, missing front matter behavior, and
  external edit races.
- `src/ui/workspace/` — add Plan detail route, rendered markdown view, front matter summary components, CodeMirror
  editor island, save API route, and browser-local draft recovery.
- `deno.json` — add root task/import updates only if needed for Workspace editor verification.
- `deno.lock` — add CodeMirror and markdown rendering dependencies as required.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan`, front matter extraction/injection, `stripLeadingFrontMatterBlock`, and
  canonical path handling.
- `src/ui/workspace/` read-only APIs — reuse existing `planId` lookup and server-side adapter boundaries.
- CodeMirror 6 markdown pattern — use `EditorView`, `basicSetup`, and `@codemirror/lang-markdown` for source-preserving
  markdown editing.
- Existing Plan front matter fields — render classification, status, summary, worktree metadata, dependencies, and
  parent/Epic information read-only.

## Implementation Steps

- [ ] Step 1: Add a Plan-store helper that returns Plan body, front matter, body hash/revision, plan name, path
      metadata, and display metadata for a `planId`.
- [ ] Step 2: Add a body-only save helper that takes `planId` or canonical plan name, new body text, and expected body
      hash/revision, then rewrites the markdown file with front matter preserved.
- [ ] Step 3: Add tests proving body saves do not change workflow-critical front matter, reject stale hashes, and keep
      unknown front matter keys intact.
- [ ] Step 4: Add a Plan detail route with rendered markdown as the default read-first experience.
- [ ] Step 5: Add a front matter summary panel that displays lifecycle/worktree/dependency fields but does not allow raw
      YAML editing.
- [ ] Step 6: Add a CodeMirror editor island for body markdown, explicit Save/Cancel actions, unsaved-change warnings,
      and browser-local draft recovery.
- [ ] Step 7: Add save API token/header plumbing consistent with the Workspace security model, even if lifecycle
      mutation APIs are not implemented yet.

## Verification Plan

- Automated: run `deno task ci`, `deno task -c src/ui/workspace/deno.json check`, and
  `deno task -c src/ui/workspace/deno.json test` if a Workspace test task exists.
- Manual: open a Plan detail page, edit body markdown, save, refresh, and verify the body changed while front matter
  remained valid and workflow-critical fields did not change.
- Expected results for key scenarios: stale saves are rejected after an external disk edit; unsaved browser drafts are
  recoverable after refresh; Plan markdown remains canonical and readable by existing CLI/agent workflows.

## Edge Cases & Considerations

- The editor must not expose raw front matter editing in v1.
- Hash/revision comparison should be based on current on-disk body content, not stale data cached in the browser.
- Unknown front matter keys must be preserved by existing parse/inject behavior.
- Draft recovery should avoid cross-project contamination by including project/workspace identity in the storage key.
- Markdown rendering must avoid unsafe HTML/script execution in Plan bodies.
- All implementation source must remain JavaScript/JSDoc only.
