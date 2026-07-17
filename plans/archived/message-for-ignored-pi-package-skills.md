---
planId: "e80e2eee-d553-47a9-980e-0e45254ce371"
classification: "FEATURE"
complexity: "LOW"
summary: "When Harns installs a Pi package that contains skills, keep ignoring those skills but print guidance to install them with the external npx skills CLI."
affectedPaths:
    - "src/cmd/install/index.js"
    - "src/cmd/install/index.test.js"
    - "src/cmd/registry.js"
    - "docs/settings.md"
createdAt: "2026-06-16T17:00:46-04:00"
updatedAt: "2026-07-17T04:49:13.105Z"
status: "verified"
origin: "internal"
workRecord:
    status: "generated"
    recordId: "fabbd4dc-66e4-484e-9bc1-81b41e9222ee"
    path: "docs/work-records/2026-07-17-message-for-ignored-pi-package-skills.md"
    lastAttemptAt: "2026-07-17T04:49:06.872Z"
---

# Message For Ignored Pi Package Skills

## Context

Themes and prompt templates are passive enough for Harns to support through the package manager, while executable Pi
extensions need a Harns compatibility gate. Skills are the remaining Pi package resource surface. Harns should continue
to ignore Pi-packaged skills instead of becoming a skill installer, because skill distribution is becoming its own
ecosystem.

The current external standard is the Vercel Labs `skills` CLI. Its README describes installing skills with
`npx skills add <source>`, plus options like `-a/--agent` for target agents and `--skill` for selecting individual
skills.

## Objective

When `hns install <source>` installs a package that contributes Pi skill resources, keep ignoring those skills but show
a clear message that directs users to install skills separately with `npx skills add <source>`.

## Approach

Update install reporting only. Do not load Pi skills, copy skill files, or add a Harns skill installer. After
`DefaultPackageManager.resolve()` identifies resources from the installed source, count skill resources separately from
ignored executable extensions and other unsupported resources.

For any nonzero skill count, print a message like:

```text
Skills ignored: 3
Install skills separately with: npx skills add <source>
```

If Harns wants a slightly more agent-targeted hint, the message can add:

```text
Use -a codex, -a claude-code, or another supported agent to choose where skills are installed.
```

Keep the output informational and non-blocking.

## Files to Modify

- `src/cmd/install/index.js` - count skill resources from the installed source and print `npx skills add <source>`
  guidance when they are present.
- `src/cmd/install/index.test.js` - update install-output expectations for packages with skills, packages without
  skills, and packages with both skills and other ignored resources.
- `src/cmd/registry.js` - update install help text so users know Harns does not install skills and points to
  `npx skills`.
- `docs/settings.md` - document that Pi-packaged skills are intentionally ignored and should be installed with the
  external skills CLI.

## Reuse Opportunities

- `src/cmd/install/index.js` - reuse the existing `fromSource` filtering and install summary output.
- `src/cmd/install/index.test.js` - reuse the existing fake `PackageManager.resolve()` test setup.
- `plans/allow-harns-compatible-pi-extensions.md` - keep the broader policy aligned: code extensions gated, themes
  passive, prompts passive, skills ignored with guidance.

## Implementation Steps

- [x] Split install reporting into explicit counts for themes, compatible extensions, prompts if that plan has landed,
      ignored executable extensions, ignored skills, and any remaining ignored resources.
- [x] When `skillCount > 0`, print a concise guidance line using the exact source the user installed:
      `npx skills add <source>`.
- [x] Optionally mention `-a/--agent` for users who want to target Codex, Claude Code, or another supported agent.
- [x] Update install tests so skill resources no longer disappear inside a generic "Non-theme resources ignored" count.
- [x] Update CLI help and settings docs with the same external-install guidance.

## Verification Plan

- Automated:
  `deno fmt --check src/cmd/install/index.js src/cmd/install/index.test.js src/cmd/registry.js docs/settings.md`
- Automated: `deno test src/cmd/install/index.test.js`
- Automated: `deno run ci`
- Manual: install a fixture package with `pi.skills` and confirm Harns reports that skills were ignored and prints
  `npx skills add <source>`.
- Manual: install a fixture package with only themes and confirm no skills guidance appears.

## Edge Cases & Considerations

- The message should use the original install source exactly, so npm, git, GitHub shorthand, and local sources all
  produce copyable guidance.
- Harns should not shell out to `npx`, install Node dependencies, or mutate skill directories.
- If a package has both supported resources and skills, supported resources should still register while skills are
  reported as ignored.
- The Vercel Labs CLI supports many agents; Harns should not hardcode only one target unless a future product decision
  adds Harns-specific skills support.
