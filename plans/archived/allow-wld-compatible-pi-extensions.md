---
planId: "44407264-433c-4ac6-93a3-6a3aa0a46f77"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Allow RunWield to install and load explicitly WLD-compatible Pi-shaped code extension packages after clear user consent, while keeping passive themes and prompts unchanged."
affectedPaths:
    - "src/cmd/install/index.js"
    - "src/cmd/install/index.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/extensions/wld-extension-manifest.js"
    - "src/shared/extensions/wld-extension-manifest.test.js"
    - "src/cmd/registry.js"
    - "docs/settings.md"
createdAt: "2026-06-16T16:46:54-04:00"
updatedAt: "2026-07-17T04:41:20.973Z"
status: "verified"
origin: "internal"
workRecord:
    status: "generated"
    recordId: "770c5b8f-23c5-488c-b9ad-c8f718b7c1e1"
    path: "docs/work-records/2026-07-17-enabled-consent-gated-wld-compatible-pi-extensions.md"
    lastAttemptAt: "2026-07-17T04:41:11.361Z"
---

# Allow WLD-Compatible Pi Extensions

## Context

RunWield currently wraps Pi's package manager for install/remove, and external themes and package prompt templates are
already registered at runtime. Themes and prompts should continue to work as they do today because they are passive
resources.

Installed Pi extension resources are counted as ignored because arbitrary extension logic has real power: extensions can
register tools, alter prompts, intercept tool calls, read project/session data, call external services, and mutate agent
behavior. At the same time, optional code extensions are the right shape for features like Colgrep semantic search,
where users should opt in instead of making the dependency part of core RunWield.

## Objective

Enable RunWield to install and load a narrow class of Pi-shaped code extension packages that explicitly declare WLD
compatibility and receive user consent during install. Continue registering themes and prompt templates through their
existing passive-resource paths. Continue ignoring skills in this feature.

The package metadata annotation is author self-attestation: it means the package author says the extension was made for
WLD/RunWield or tested with WLD/RunWield. It is not vetting by RunWield and is not a security guarantee. RunWield must
make executable extension loading visible, testable, and gated by an explicit user yes/no prompt.

## Approach

Introduce two gates on top of Pi package resolution:

1. **Package self-attestation:** Pi packages may still use `pi.extensions` to point at extension entry files, but
   RunWield only considers those entries when the package also declares a WLD-specific annotation.
2. **User consent:** before any compatible code extension is enabled for loading, RunWield asks the user to consent
   after a clear warning that extension code is powerful, not vetted by RunWield, and may leak data or cause other
   issues.

Example package metadata:

```json
{
    "pi": {
        "extensions": ["./index.js"],
        "wld": {
            "compatible": true,
            "extensionApi": 1,
            "kind": "code-extension"
        }
    }
}
```

The compatibility marker must live in package metadata, not inside the extension's runtime code. The install flow is the
consent boundary: if the user agrees, RunWield persists the package entry with its compatible extension resources
enabled; after that, installed WLD-compatible extension resources are loaded like any other installed package resource.

When `wld install <source>` finds one or more WLD-compatible code extensions, show a prompt like:

```text
Package source contains WLD-compatible code extensions: 2

Extensions can register tools, alter prompts, intercept tool calls, read project/session data, and call external
services. RunWield has not vetted this extension package. It could leak data, run unwanted commands, or cause other
issues.

Enable these extensions for loading? [y/N]
```

If the user answers yes, persist the installed package entry with those compatible extension resources enabled. If the
user answers no or the install is running non-interactively without an affirmative flag, install and register passive
resources as usual but leave extension resources out of the persisted package entry and report the compatible extensions
as skipped.

RunWield should resolve installed packages through Pi's `DefaultPackageManager`, continue handing theme resources to the
existing theme registry, keep package prompt handling separate, filter only extension resources to compatible and
installed package entries, pass those extension paths to `DefaultResourceLoader`, and report ignored resources clearly.

## Files to Modify

- `src/cmd/install/index.js` - distinguish WLD-compatible extension resources from ignored extension resources in
  install output, warn about extension power, ask for user consent, and include compatible extension resources in the
  persisted package entry only after an affirmative answer.
- `src/cmd/install/index.test.js` - cover install summaries for themes, compatible extensions, ignored extensions, and
  skills; cover consent yes/no and non-interactive default-deny behavior.
- `src/shared/session/session.js` - resolve compatible extension paths and pass them to `DefaultResourceLoader` via
  `additionalExtensionPaths` while retaining built-in Mnemosyne/Cymbal/Snip factories.
- `src/shared/session/session-catalog.test.js` - verify compatible extension paths are included in session resource
  loading only when present in installed package resources; incompatible or skipped package extensions are excluded.
- `src/shared/extensions/wld-extension-manifest.js` - add pure JS helpers for reading package metadata, interpreting
  `pi.wld`, and filtering resolved Pi extension resources to the WLD-compatible subset.
- `src/shared/extensions/wld-extension-manifest.test.js` - cover manifest parsing, missing metadata, incompatible
  packages, local paths, npm/git package metadata, malformed package files, and enabled/skipped resource filtering.
- `src/cmd/registry.js` - update install/reload help text so RunWield no longer claims all logic extensions are ignored.
- `docs/settings.md` - document the WLD extension compatibility marker, install behavior, consent prompt, and security
  posture.

## Reuse Opportunities

- `src/cmd/install/index.js` - reuse existing `DefaultPackageManager.installAndPersist()` and `resolve()` flow.
- `src/shared/ui/theme.js` - leave the current passive theme registration behavior intact while reusing its lazy package
  resource resolution pattern.
- `../pi-mono/packages/coding-agent/src/core/package-manager.ts` - reference `ResolvedResource.metadata.baseDir`,
  `source`, and `origin` behavior when designing the manifest filter.
- `src/shared/session/session.js` - reuse the existing `DefaultResourceLoader` construction and built-in extension
  factory list.

## Implementation Steps

- [x] Add `src/shared/extensions/wld-extension-manifest.js` with helpers that locate the nearest package root for a
      resolved extension resource, read `package.json`, and return whether the package declares WLD compatibility.
- [x] Define the first compatibility contract in code and docs: `pi.wld.compatible: true`, `extensionApi: 1`, and
      `kind: "code-extension"`.
- [x] Update `runInstallCommand` to count compatible extensions separately from ignored extensions, while still ignoring
      skills.
- [x] Add an install consent prompt for compatible extensions. The prompt must default to no and clearly state that
      extensions are powerful code, not vetted by RunWield, and may leak data or cause other issues.
- [x] When the user consents, keep compatible extension resources enabled in the installed package entry. When the user
      declines, persist `extensions: []` while still allowing passive resources from the package.
- [x] Update install tests to assert that compatible extension resources are reported as enabled/loadable only after
      install consent; incompatible or skipped extension resources are reported as ignored/skipped.
- [x] Add a session helper that creates a `DefaultPackageManager`, resolves installed resources, filters compatible
      installed extension paths, and returns paths suitable for `additionalExtensionPaths`.
- [x] Pass the filtered extension paths into `DefaultResourceLoader` without enabling Pi skills or context file loading.
- [x] Surface extension load failures through the existing `extensionsResult.errors` reporting path with enough source
      information for users to uninstall or fix the package.
- [x] Update help/settings docs to explain that WLD extensions are Pi-shaped, must be explicitly annotated as
      WLD-compatible, and require user consent because they execute trusted code.

## Verification Plan

- Automated:
  `deno fmt --check src/cmd/install/index.js src/cmd/install/index.test.js src/shared/session/session.js src/shared/session/session-catalog.test.js src/shared/extensions/wld-extension-manifest.js src/shared/extensions/wld-extension-manifest.test.js src/cmd/registry.js docs/settings.md`
- Automated:
  `deno test src/cmd/install/index.test.js src/shared/extensions/wld-extension-manifest.test.js src/shared/session/session-catalog.test.js`
- Automated: `deno run ci`
- Manual: install a fixture package with `pi.wld.compatible: true`, answer yes to the warning, and confirm RunWield
  reports the extension as loadable.
- Manual: install a fixture package with `pi.wld.compatible: true`, answer no to the warning, and confirm RunWield keeps
  passive resources but does not persist/load extension resources.
- Manual: install a fixture package with plain `pi.extensions` but no WLD marker and confirm RunWield reports it as
  ignored and does not load it.

## Edge Cases & Considerations

- Extension code can mutate agent behavior through Pi hooks and access sensitive local context. Compatibility
  self-attestation plus install-time user consent is an explicit trusted-code decision, not a sandbox.
- RunWield should not auto-load arbitrary `.pi/extensions` directories or plain Pi package extensions just because Pi
  can discover them.
- Themes are explicitly out of the new trust gate. They should keep working as passive JSON resources with the existing
  theme precedence and validation behavior.
- Skills remain ignored. Prompt support is covered by `plans/allow-harns-compatible-extension-prompts.md` and does not
  require the executable-extension compatibility gate.
- Local package paths need the same compatibility gate as npm/git packages.
- If a package contains both a theme and an incompatible extension, the theme should still register while the extension
  remains ignored.
- If a package contains passive resources and a compatible extension but the user declines extension consent, themes and
  prompts should still work while the extension resource is not persisted for loading.
