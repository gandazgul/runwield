---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Allow Harns to install and load explicitly Harns-compatible Pi-shaped code extension packages while keeping passive themes unchanged and leaving prompt support to a separate plan."
affectedPaths:
    - "src/cmd/install/index.js"
    - "src/cmd/install/index.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/extensions/harns-extension-manifest.js"
    - "src/shared/extensions/harns-extension-manifest.test.js"
    - "src/cmd/registry.js"
    - "docs/settings.md"
createdAt: "2026-06-16T16:46:54-04:00"
status: "draft"
---

# Allow Harns-Compatible Pi Extensions

## Context

Harns currently wraps Pi's package manager for install/remove, and external themes are already registered at runtime.
Themes should continue to work as they do today because JSON theme resources are passive and comparatively harmless.
Installed Pi extension resources are counted as ignored because arbitrary extension logic is a large footgun: extensions
can register tools, alter prompts, intercept tool calls, and mutate agent behavior. At the same time, optional code
extensions are the right shape for features like Colgrep semantic search, where users should opt in instead of making
the dependency part of core Harns.

## Objective

Enable Harns to install and load a narrow class of Pi-shaped code extension packages that explicitly declare Harns
compatibility. Continue registering themes through the existing theme path. Continue ignoring skills in this feature.
Prompt templates are passive enough to be handled separately without this compatibility gate. Harns must make executable
extension loading visible, testable, and opt-in at the package-manifest level.

## Approach

Introduce a Harns compatibility gate on top of Pi package resolution. Pi packages may still use `pi.extensions` to point
at extension entry files, but Harns only loads those entries when the package also declares a Harns-specific annotation,
for example:

```json
{
    "pi": {
        "extensions": ["./index.js"],
        "harns": {
            "compatible": true,
            "extensionApi": 1,
            "kind": "code-extension"
        }
    }
}
```

The exact field name can be adjusted during implementation, but the compatibility marker must live in package metadata,
not inside the extension's runtime code. Harns should resolve installed packages through Pi's `DefaultPackageManager`,
continue handing theme resources to the existing theme registry, filter only extension resources to compatible packages,
pass those extension paths to `DefaultResourceLoader`, and report ignored resources clearly.

## Files to Modify

- `src/cmd/install/index.js` - distinguish Harns-compatible extension resources from ignored extension resources in
  install output.
- `src/cmd/install/index.test.js` - cover install summaries for themes, compatible extensions, ignored extensions, and
  skills.
- `src/shared/session/session.js` - resolve compatible extension paths and pass them to `DefaultResourceLoader` via
  `additionalExtensionPaths` while retaining built-in Mnemosyne/Cymbal/RTK factories.
- `src/shared/session/session-catalog.test.js` - verify compatible extension paths are included in session resource
  loading and incompatible package extensions are excluded.
- `src/shared/extensions/harns-extension-manifest.js` - add pure JS helpers for reading package metadata and filtering
  resolved Pi extension resources to the Harns-compatible subset.
- `src/shared/extensions/harns-extension-manifest.test.js` - cover manifest parsing, missing metadata, incompatible
  packages, local paths, npm/git package metadata, and malformed package files.
- `src/cmd/registry.js` - update install/reload help text so Harns no longer claims all logic extensions are ignored.
- `docs/settings.md` - document the Harns extension compatibility marker, install behavior, and security posture.

## Reuse Opportunities

- `src/cmd/install/index.js` - reuse existing `DefaultPackageManager.installAndPersist()` and `resolve()` flow.
- `src/shared/ui/theme.js` - leave the current passive theme registration behavior intact while reusing its lazy package
  resource resolution pattern.
- `../pi-mono/packages/coding-agent/src/core/package-manager.ts` - reference `ResolvedResource.metadata.baseDir`,
  `source`, and `origin` behavior when designing the manifest filter.
- `src/shared/session/session.js` - reuse the existing `DefaultResourceLoader` construction and built-in extension
  factory list.

## Implementation Steps

- [ ] Add `src/shared/extensions/harns-extension-manifest.js` with helpers that locate the nearest package root for a
      resolved extension resource, read `package.json`, and return whether the package declares Harns compatibility.
- [ ] Define the first compatibility contract in code and docs: `pi.harns.compatible: true`, `extensionApi: 1`, and
      `kind: "code-extension"`.
- [ ] Update `runInstallCommand` to count compatible extensions separately from ignored extensions, while still ignoring
      skills.
- [ ] Update install tests to assert that compatible extension resources are reported as enabled/loadable and
      incompatible extension resources are reported as ignored.
- [ ] Add a session helper that creates a `DefaultPackageManager`, resolves installed resources, filters compatible
      extension paths, and returns paths suitable for `additionalExtensionPaths`.
- [ ] Pass the filtered extension paths into `DefaultResourceLoader` without enabling Pi skills or context file loading.
- [ ] Surface extension load failures through the existing `extensionsResult.errors` reporting path with enough source
      information for users to uninstall or fix the package.
- [ ] Update help/settings docs to explain that Harns extensions are Pi-shaped but must be explicitly annotated as
      Harns-compatible.

## Verification Plan

- Automated:
  `deno fmt --check src/cmd/install/index.js src/cmd/install/index.test.js src/shared/session/session.js src/shared/session/session-catalog.test.js src/shared/extensions/harns-extension-manifest.js src/shared/extensions/harns-extension-manifest.test.js src/cmd/registry.js docs/settings.md`
- Automated:
  `deno test src/cmd/install/index.test.js src/shared/extensions/harns-extension-manifest.test.js src/shared/session/session-catalog.test.js`
- Automated: `deno run ci`
- Manual: install a fixture package with `pi.harns.compatible: true` and confirm Harns reports the extension as
  loadable.
- Manual: install a fixture package with plain `pi.extensions` but no Harns marker and confirm Harns reports it as
  ignored and does not load it.

## Edge Cases & Considerations

- Extension code can mutate agent behavior through Pi hooks, so compatibility must be opt-in and documented as trusted
  code execution.
- Harns should not auto-load arbitrary `.pi/extensions` directories or plain Pi package extensions just because Pi can
  discover them.
- Themes are explicitly out of the new trust gate. They should keep working as passive JSON resources with the existing
  theme precedence and validation behavior.
- Skills remain ignored. Prompt support is covered by `plans/allow-harns-compatible-extension-prompts.md` and does not
  require the executable-extension compatibility gate.
- Local package paths need the same compatibility gate as npm/git packages.
- If a package contains both a theme and an incompatible extension, the theme should still register while the extension
  remains ignored.
