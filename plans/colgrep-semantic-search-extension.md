---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Create an optional Harns-compatible Colgrep extension that adds semantic code discovery without making Colgrep a core Harns dependency."
affectedPaths:
    - "extensions/colgrep/package.json"
    - "extensions/colgrep/index.js"
    - "extensions/colgrep/index.test.js"
    - "extensions/colgrep/README.md"
    - "docs/settings.md"
createdAt: "2026-06-16T16:46:54-04:00"
status: "draft"
---

# Colgrep Semantic Search Extension

## Context

Cymbal gives Harns agents fast structural navigation: symbols, references, importers, traces, and impact analysis. It is
less suited to natural-language discovery when the agent or user does not know the symbol name yet. Colgrep is a local
semantic/hybrid code search CLI that can fill that first-hop discovery gap, but it should remain optional because it
adds model/index/runtime complexity.

This plan depends on `plans/allow-harns-compatible-pi-extensions.md` so the extension can be installed as trusted,
Harns-compatible Pi-shaped code instead of becoming a built-in dependency.

## Objective

Create a separately installable Harns-compatible Colgrep extension that registers a `code_semantic_search` tool and
runtime prompt guidance. Agents should use it to find candidate code neighborhoods by intent or pattern, then verify
with Cymbal, direct source reads, grep, tests, or configuration before editing or making impact claims.

## Approach

Add a small extension package under `extensions/colgrep/` that can later be published or installed via a local/git
source. The package should be pure JavaScript and Pi-extension-shaped, with a Harns compatibility marker in
`package.json`.

The extension should:

- Register `code_semantic_search` backed by the `colgrep` CLI.
- Provide a concise `promptSnippet` and `promptGuidelines`.
- Use `before_agent_start` to append Colgrep-specific guidance only when the tool is available.
- Use `tool_result` nudges sparingly when broad conceptual shell searches would likely benefit from semantic search.
- Fail softly when `colgrep` is not installed or the index is not ready.

## Files to Modify

- `extensions/colgrep/package.json` - define a local extension package with `pi.extensions` and the Harns compatibility
  marker from the extension-loading plan.
- `extensions/colgrep/index.js` - implement the Pi extension, tool registration, CLI execution, prompt guidance, and
  optional nudges.
- `extensions/colgrep/index.test.js` - cover tool registration, CLI argument mapping, soft failure behavior, prompt
  injection, and nudge behavior.
- `extensions/colgrep/README.md` - document installation, required `colgrep init`, usage examples, and the relationship
  with Cymbal.
- `docs/settings.md` - reference Colgrep as the first example of a Harns-compatible optional code extension.

## Reuse Opportunities

- `src/extensions/cymbal/index.js` - mirror the shape of external CLI wrapping, tool definitions, and `tool_result`
  nudge handling.
- `src/extensions/cymbal/index.test.js` - reuse test patterns for fake `pi.exec`, tool registration, command mapping,
  and nudge assertions.
- `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md` - align the extension prompt guidance with the existing "Cymbal is the
  fast path, source is authority" exploration language.
- Colgrep CLI JSON output - prefer structured parsing when practical, while preserving a readable fallback for agents.

## Implementation Steps

- [ ] Create `extensions/colgrep/package.json` with a JS entrypoint, `pi.extensions`, and the Harns compatibility marker
      defined by the extension-loading plan.
- [ ] Implement `codeSemanticSearchToolDef` in `extensions/colgrep/index.js` with parameters for `query`, optional
      `path`, optional result count, optional `semanticOnly`, and optional `codeOnly`.
- [ ] Execute `colgrep` through `pi.exec` from the current project cwd, using conservative defaults such as hybrid
      search and bounded result count.
- [ ] Normalize empty output, non-zero exits, missing binary errors, and index-not-ready messages into concise tool
      results that tell the agent what to do next.
- [ ] Add `promptSnippet` and `promptGuidelines` that say semantic search is for discovery and pattern finding, not
      exhaustive refs, signatures, imports, or blast radius.
- [ ] Add a `before_agent_start` hook that appends a short "Colgrep Semantic Search" policy section when the extension
      is active.
- [ ] Add optional `tool_result` nudges for broad conceptual `bash`/`grep` searches, while avoiding noisy nags for exact
      symbol searches where Cymbal is better.
- [ ] Write focused extension tests using a fake Pi API, following the Cymbal extension test style.
- [ ] Document install and setup flow, including `colgrep init`, privacy/local-index notes, and verification
      expectations.

## Verification Plan

- Automated:
  `deno fmt --check extensions/colgrep/package.json extensions/colgrep/index.js extensions/colgrep/index.test.js extensions/colgrep/README.md docs/settings.md`
- Automated: `deno test extensions/colgrep/index.test.js`
- Automated: `deno run ci`
- Manual: install the local extension package through Harns after the compatibility-loading plan is implemented and
  confirm `code_semantic_search` appears in the agent's available tools.
- Manual: run `code_semantic_search` against an indexed repo and confirm the agent treats results as candidates, then
  verifies with Cymbal or source reads.

## Edge Cases & Considerations

- Colgrep is optional; missing `colgrep` must not block Harns sessions.
- Semantic search results are not proof. The extension prompt must explicitly steer agents toward verification before
  edits, refactors, or impact claims.
- Colgrep setup may require model/index resources; the extension should report actionable setup guidance instead of
  crashing or producing huge output.
- Exact references, imports, and blast radius remain Cymbal's job.
- Keep output bounded to avoid flooding the model with large snippets.
- The extension package should remain pure JavaScript with JSDoc typing, not TypeScript.
