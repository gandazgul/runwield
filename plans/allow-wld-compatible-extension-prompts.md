---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Allow installed Pi packages to contribute slash prompt templates without the Harns code-extension compatibility gate while protecting built-in command names by default."
affectedPaths:
    - "plans/allow-harns-compatible-pi-extensions.md"
    - "src/shared/extensions/harns-extension-manifest.js"
    - "src/shared/extensions/harns-extension-manifest.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/boot-banner.js"
    - "src/shared/interactive/boot-banner.test.js"
    - "src/cmd/install/index.js"
    - "src/cmd/install/index.test.js"
    - "docs/settings.md"
createdAt: "2026-06-16T16:51:18-04:00"
status: "draft"
---

# Allow Pi Package Prompts

## Context

`plans/allow-harns-compatible-pi-extensions.md` introduces a Harns compatibility gate for executable Pi-shaped extension
packages. That gate is important for code extensions because Pi extensions can register tools, alter prompts, and
intercept agent behavior in ways that may break Harns. Prompt templates are different: they are passive Markdown routed
through existing slash-command handling, not arbitrary code. They should not need the Harns code-extension compatibility
marker.

The remaining risk is command-surface confusion. A package prompt named like a built-in command such as `/help`,
`/agent`, `/models`, `/load-plan`, or `/theme` can shadow or confuse core Harns workflows. Harns already blocks local
and home prompt templates that collide with built-in slash command names; package prompts should enter through the same
policy.

## Objective

Allow installed Pi packages to contribute prompt templates without requiring `pi.harns.compatible`. Continue ignoring
skills. Keep themes unchanged. Protect Harns built-in slash command names by default, while leaving the design open for
an explicit trusted override policy later if Harns decides package prompts may intentionally replace built-ins.

## Approach

Reuse Pi package resolution to collect installed `pi.prompts` resources from npm, git, and local packages. Do not
require the Harns compatibility marker for prompt resources; reserve that marker for executable code extensions. Harns
should still keep default Pi prompt discovery off and explicitly pass the resolved package prompt paths it wants to
expose.

Pass package prompt paths to Pi's `DefaultResourceLoader` through `additionalPromptTemplatePaths` while keeping
`noPromptTemplates: true`. Pi already treats additional prompt paths as explicit paths even when default Pi prompt
discovery is disabled, so this preserves Harns control over which package prompts enter the session.

For built-in name collisions, use the existing chat-session filtering path as the enforcement point. The conservative
MVP should ignore package prompts whose normalized name matches a built-in slash command invocation. If later desired,
add a manifest-level opt-in such as `pi.harns.allowBuiltinPromptOverride: true`, but do not implement that override in
this first prompt-support feature.

## Files to Modify

- `plans/allow-harns-compatible-pi-extensions.md` - update the follow-up note or edge cases to say prompts are passive
  package resources handled by this plan and do not require the executable-extension compatibility gate.
- `src/shared/extensions/harns-extension-manifest.js` - keep compatibility filtering focused on executable extension
  resources; add or reuse package-resource helpers for prompt paths without applying the Harns marker.
- `src/shared/extensions/harns-extension-manifest.test.js` - cover extension-gated code resources separately from
  ungated prompt resources.
- `src/shared/session/session.js` - include resolved package prompt paths in `DefaultResourceLoader` via
  `additionalPromptTemplatePaths` while keeping default Pi prompt discovery disabled.
- `src/shared/session/session-catalog.test.js` - verify package prompts are loaded into Harns prompt metadata without a
  Harns compatibility marker.
- `src/shared/interactive/chat-session.js` - ensure package prompt templates that collide with built-in slash command
  names are excluded from invocation just like local/home prompt collisions.
- `src/shared/interactive/boot-banner.js` - surface a warning for blocked package prompts with user-facing
  package/source information.
- `src/shared/interactive/boot-banner.test.js` - cover blocked package prompt warnings and normal package prompt
  display.
- `src/cmd/install/index.js` - update install output to count package prompts separately from ignored skills and ignored
  incompatible code extensions.
- `src/cmd/install/index.test.js` - cover install summaries for package prompts.
- `docs/settings.md` - document package prompt support, built-in command collision behavior, and the conservative
  no-override default.

## Reuse Opportunities

- `src/shared/interactive/chat-session.js` - reuse the existing `builtinSlashInvocationNames`,
  `invokablePromptTemplates`, and `blockedPromptTemplates` split.
- `src/shared/interactive/boot-banner.js` - reuse the existing warning text path for prompt templates that collide with
  built-in slash commands.
- `src/shared/session/session.js` - reuse `additionalPromptTemplatePaths` and `listPromptTemplates()` rather than adding
  a separate prompt discovery system.
- `../pi-mono/packages/coding-agent/src/core/resource-loader.ts` - rely on `additionalPromptTemplatePaths` continuing to
  work when `noPromptTemplates` is true.
- `../pi-mono/packages/coding-agent/src/core/package-manager.ts` - reuse resolved `prompts` resources and
  `ResolvedResource.metadata` instead of walking package directories manually.

## Implementation Steps

- [ ] Add or reuse a package-resource helper that returns installed `pi.prompts` paths without requiring
      `pi.harns.compatible`.
- [ ] Keep skills excluded even when the same package declares `pi.skills`.
- [ ] Keep the Harns compatibility marker required only for executable `pi.extensions` resources.
- [ ] Update `buildAgentSession` to pass package prompt paths to `DefaultResourceLoader.additionalPromptTemplatePaths`
      while leaving `noPromptTemplates: true`.
- [ ] Update prompt template listing so package prompts are represented with source metadata that can be shown in
      autocomplete and warnings.
- [ ] Reuse built-in slash invocation filtering to block package prompts named like built-in commands.
- [ ] Add warning text for blocked package prompts; do not let them appear in slash autocomplete or dispatch.
- [ ] Update install output so users can see themes, compatible extensions, package prompts, ignored incompatible code
      extensions, and ignored skills separately.
- [ ] Document the default policy: built-in commands win; package prompt overrides can be reconsidered later with an
      explicit manifest opt-in.

## Verification Plan

- Automated:
  `deno fmt --check src/shared/extensions/harns-extension-manifest.js src/shared/extensions/harns-extension-manifest.test.js src/shared/session/session.js src/shared/session/session-catalog.test.js src/shared/interactive/chat-session.js src/shared/interactive/boot-banner.js src/shared/interactive/boot-banner.test.js src/cmd/install/index.js src/cmd/install/index.test.js docs/settings.md`
- Automated:
  `deno test src/shared/extensions/harns-extension-manifest.test.js src/shared/session/session-catalog.test.js src/shared/interactive/boot-banner.test.js src/cmd/install/index.test.js`
- Automated: `deno run ci`
- Manual: install a package with `pi.prompts: ["./prompts/explain.md"]` and no `pi.harns.compatible` marker, then
  confirm `/explain` appears in slash autocomplete.
- Manual: install a package with a prompt named `help.md` and confirm `/help` still invokes the Harns built-in command
  while the package prompt is warned as blocked.
- Manual: install a package with `pi.skills` and confirm Harns still ignores those skills.

## Edge Cases & Considerations

- Prompt templates are mostly harmless and do not need the Harns compatibility gate, but they can still steer agents
  into bad workflows. Keep collision warnings visible and source-aware.
- The conservative MVP blocks built-in slash command name collisions. Trusted override behavior is intentionally
  deferred until Harns has a concrete package that needs it.
- Prompt precedence should remain understandable: Harns local/home/bundled prompt behavior should not be silently broken
  by installed packages.
- If a package contributes both a blocked prompt and a valid prompt, the valid prompt should remain usable.
- Skills remain ignored in this plan.
