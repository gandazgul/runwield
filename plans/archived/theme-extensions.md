---
classification: "PROJECT"
complexity: "MEDIUM"
summary: "Wire Harns to Pi's theme system: install/list/switch external theme packages (.json only), keep catppuccin-mocha embedded as the precedence-winning fallback, and add a /theme picker with live preview."
affectedPaths:
    - "src/constants.js"
    - "src/cmd/registry.js"
    - "src/cmd/theme/index.js"
    - "src/cmd/install/index.js"
    - "src/cmd/remove/index.js"
    - "src/shared/ui/theme.js"
    - "src/shared/settings.js"
createdAt: "2026-05-10T00:00:00Z"
updatedAt: "2026-05-10T22:00:58.961Z"
status: "completed"
origin: "internal"
---

# Theme Extension Support

## Context

Harns currently hardcodes a single `catppuccin-mocha` theme: `src/shared/ui/theme.js` reads `./catppuccin-mocha.json` at
startup, constructs a Pi `Theme` instance, and pins it to the global
`Symbol.for("@earendil-works/pi-coding-agent:theme")` singleton. There is no way to switch themes at runtime or install
new ones.

Upstream `@earendil-works/pi-coding-agent` already provides everything we need:

- `loadThemeFromPath(path)` — parse + validate a theme JSON and return a `Theme` instance.
- `setRegisteredThemes(themes[])` — register external themes by name so `getAvailableThemes()` lists them.
- `setTheme(name)` / `setThemeInstance(theme)` — swap the global singleton and trigger the registered `onThemeChange`
  callback. Pi's TUI subscribes to this callback for instant re-renders, which is why no debouncing is needed.
- `getAvailableThemes()` / `getAvailableThemesWithPaths()` — enumerate built-ins + registered + custom themes.
- `PackageManager` (`src/core/package-manager.ts`) — installs `npm:`/`git:`/`local:` sources and resolves them to
  `ResolvedPaths { extensions, skills, prompts, themes }`. We filter to `themes` only.

The PRD at `docs/prd/done/theme-extensions.md` is the source spec. User-confirmed design points:

1. **Builtin precedence.** The embedded `catppuccin-mocha` always wins a name collision.
2. **Merge fallback.** External theme `colors` are merged on top of catppuccin-mocha so any missing token degrades
   gracefully to the embedded default instead of throwing.
3. **Live preview is free.** Pi's `onThemeChange` already re-renders the TUI; no Harns-side debounce.
4. **Pi's `string | object` package schema is intentional** — objects are for `git:` / `local:` sources that need to
   declare which `.json` files within the package are themes; `npm:` packages declare themes via their own
   `package.json`. We adopt the schema verbatim.
5. **Discovery deferred to `/theme`.** Loading external theme directories on boot would punish the 95% case (users never
   touch themes in a given session) for the 5% case. Discovery runs lazily when `/theme` opens or when
   `hns install`/`remove` mutates the package list.
6. **No migration.** MVP — no existing users with custom themes to preserve.
7. **Out of scope.** Logic extensions (skills/prompts/.ts/.js) are filtered out at install time; the rest of Pi's
   package manager runs as normal.

## Objective

Replace the hardcoded theme boot with a dynamic, settings-driven theme lifecycle backed by Pi's theme + package manager
infrastructure. Users can:

- Run `/theme` to open an interactive picker with live preview; Enter persists, Esc reverts to the persisted theme.
- Run `hns install npm:<pkg>` / `hns install git:<repo>` / `hns install local:./path` to add packages whose theme
  `.json` files become discoverable; all non-theme resources are silently filtered.
- Run `hns remove <source>` to uninstall.
- Trust that a broken/missing theme never bricks the TUI — the embedded `catppuccin-mocha` is always present and used as
  both the fallback theme and the merge floor for partial themes.

No new ADR is required: this is integration glue around an existing pattern (Pi's theme system + `SettingsManager` +
`PackageManager`), not a new architectural decision.

## Vertical Slice Findings

Traced the boot → render → settings → package paths:

- **Boot path.** `src/shared/ui/theme.js:130` synchronously reads `catppuccin-mocha.json` adjacent to the module and
  `initHarnsTheme()` (called at startup) constructs a `Theme` and sets the global singleton. Harns currently does
  **not** call Pi's `initTheme()` — it builds the `Theme` instance directly. To plug into Pi's
  `setTheme`/`onThemeChange`/`setRegisteredThemes` pipeline we need to switch to Pi's loader.
- **Render path.** All UI modules import `theme` from `src/shared/ui/theme.js`, which is already a Proxy over
  `globalThis[THEME_KEY]` — the same key Pi uses. This means `setTheme(name)` from Pi will be picked up by every Harns
  UI module automatically without any plumbing changes. The live-preview claim in the PRD is correct and "free" provided
  we use Pi's setter.
- **Settings path.** `src/shared/settings.js` already wires Pi's `SettingsManager` over a Harns-specific storage adapter
  at `~/.hns/settings.json` (with `~/.pi/agent/settings.json` read-fallback). The `SettingsManager` already supports
  `packages` and `theme` keys natively (it's the same one Pi uses for `pi-coding-agent`), so no schema changes are
  needed in our adapter — we just need to read/write those keys.
- **Package manager path.** Pi's `PackageManager.resolve()` returns
  `ResolvedPaths { extensions, skills, prompts, themes }`. Harns wants only `themes`. The simplest filter is to consume
  only the `themes` field of the resolved output and ignore the rest — the package itself still installs to disk, we
  just don't register the logic resources with any Harns runtime (and Harns has no extension/skill registry to register
  them with anyway).
- **Theme name uniqueness.** Pi loads built-ins by file basename (`dark`, `light`) and registered themes by
  `theme.name`. To enforce builtin-precedence we register the embedded theme **first** via
  `setRegisteredThemes([embedded, ...external])` and skip any external theme whose `name` matches the embedded one.

## Files to Modify

- `src/constants.js` — add `THEME: "theme"`, `INSTALL: "install"`, `REMOVE: "remove"` to `COMMAND_NAMES`. (If
  `install`/`remove` already exist or are deferred to a future PR, scope this plan to `THEME` only and treat
  install/remove as a follow-up — see Edge Cases.)
- `src/cmd/registry.js` — register the three new commands. `/theme` is slash + cli, `install`/`remove` are cli-only.
- `src/cmd/theme/index.js` — **new**. Exports `runThemeCommand(argv, options)`:
  - No-args + slash: open a `SelectList` of `getAvailableThemes()`, wire `onSelectionChange` → `setTheme(name)` for live
    preview, on confirm persist `settings.theme = name` (global scope), on cancel call `setTheme(originalName)` to
    revert.
  - With arg: `hns theme <name>` non-interactively switches and persists.
  - `--list`: print available themes.
  - Before opening the picker, call a one-time `discoverAndRegisterThemes()` (see `src/shared/ui/theme.js` below).
- `src/cmd/install/index.js` — **new**. Thin wrapper around Pi's `PackageManager.installAndPersist(source)`. After
  install, call `discoverAndRegisterThemes()` to refresh the registry. Print summary of `.json` themes detected; print
  one line noting that non-theme resources in the package were ignored (so users aren't surprised). Source forms:
  `npm:<spec>`, `git:<url>`, `local:<path>`.
- `src/cmd/remove/index.js` — **new**. Thin wrapper around `PackageManager.removeAndPersist(source)`. If the removed
  package owned the currently-active theme, reset `settings.theme` to `catppuccin-mocha` and call
  `setTheme("catppuccin-mocha")`.
- `src/shared/ui/theme.js` — refactor:
  - Replace the hand-rolled `initHarnsTheme()` with a thin shim that:
    1. Loads embedded `catppuccin-mocha.json` (still bundled into the binary).
    2. Builds a Pi `Theme` instance from it via `loadThemeFromPath` against the embedded file (or constructs the JSON
       in-memory and passes to a Pi helper — see Reuse Opportunities).
    3. Calls `setRegisteredThemes([embeddedTheme])` and `setThemeInstance(embeddedTheme)` as the boot default. This
       installs Pi's pipeline so subsequent `setTheme(name)` calls work.
  - Add `discoverAndRegisterThemes()`: read `settings.packages`, run `PackageManager.resolve()`, take only
    `resolved.themes[]`, for each call `loadThemeFromPath()`, **merge each external theme's `colors` and `vars` on top
    of catppuccin-mocha's** (so missing tokens fall back), drop any whose `name` equals `"catppuccin-mocha"` (builtin
    precedence), and call `setRegisteredThemes([embedded, ...external])`. Idempotent — safe to call repeatedly.
  - Add `applyPersistedTheme()`: read `settings.theme`; if set and the name resolves, call `setTheme(name)`; otherwise
    stay on the embedded default. Called once at startup _after_ `discoverAndRegisterThemes()` — but per the
    lazy-discovery decision, we instead defer the _discovery_ step and only call `applyPersistedTheme()` against the
    registered set (which at boot contains only the embedded theme). If `settings.theme` names an external theme, that
    branch needs to either (a) discover lazily and then apply, or (b) stay on the fallback until first `/theme` open.
    **Decision: lazy-discover at boot only when `settings.theme !== "catppuccin-mocha"`.** This keeps the cold-boot fast
    path for 95% of users on the default theme while still honoring persisted choices for the 5% who configured one.
- `src/shared/settings.js` — no storage adapter changes. Add two small helpers (or inline at call sites):
  `getActiveThemeName()` and `setActiveThemeName(name)` that read/write `settings.theme` on the global scope. `packages`
  reads/writes go through Pi's existing `SettingsManager` API directly.
- `src/shared/ui/catppuccin-mocha.json` — **no change**. Already embedded into the binary and loaded adjacent to
  `theme.js` via `new URL("./catppuccin-mocha.json", import.meta.url)`. It serves as both the boot default and the merge
  floor for partial external themes. Ignore the PRD's `theme/catppuccin-mocha.json` line — the file's current location
  works.

## Reuse Opportunities

- **Pi's `Theme` class and loaders** (`@earendil-works/pi-coding-agent`): `loadThemeFromPath`, `getAvailableThemes`,
  `getAvailableThemesWithPaths`, `setRegisteredThemes`, `setTheme`, `setThemeInstance`, `onThemeChange`,
  `getThemeByName`. Everything Harns needs is exported.
- **Pi's `PackageManager`** via `SettingsManager` — handles `npm:` / `git:` / `local:` resolution, lockfile-like
  persistence in `settings.packages`, and progress callbacks. Filter its output to `themes` only.
- **Pi's theme JSON schema and validator** (`ThemeJsonSchema` in
  `pi-mono/packages/coding-agent/src/modes/interactive/theme/theme.ts`) — used internally by `parseThemeJsonContent`. We
  get free validation; malformed themes throw on `loadThemeFromPath` and we catch + skip with a warning rather than
  crashing.
- **Existing Harns `theme` Proxy** (`src/shared/ui/theme.js:22`) — already reads from the same global key Pi uses. No UI
  module needs to change.
- **`SelectList` component** from `@earendil-works/pi-tui` — used elsewhere in Harns (`src/cmd/resume`,
  `src/cmd/agents`); reuse the same pattern for the `/theme` picker, including its `onSelectionChange` callback for live
  preview.

## Tasks

| Task | Assignee   | Dependencies | Description                                                                                                                                                                                                  |
| ---- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | engineer   | none         | Theme switching foundation + `/theme` picker: refactor `theme.js` onto Pi's setter pipeline, lazy-discover external themes, apply persisted theme on boot, and add `/theme` slash + CLI with live preview.   |
| 2    | engineer   | 1            | `hns install` / `hns remove` CLI commands wrapping Pi's `PackageManager` with themes-only filtering; refresh theme registry after mutation; reset active theme to embedded if its owning package is removed. |
| 3    | doc-writer | 1, 2         | Document the new `/theme`, `hns install`, `hns remove` surfaces and the `theme` + `packages` settings keys; note that non-theme resources in theme packages are silently ignored.                            |
| 4    | tester     | 1, 2, 3      | Run the project's full verification command (`deno task check` / `deno test`) and execute the Manual scenarios in the Verification Plan section. Report failures explicitly so a follow-up task can fix.     |

### Slice Details

#### Task 1 — Theme switching foundation + `/theme` picker

**What to build**

End-to-end theme switching backed by Pi's theme pipeline. The embedded `catppuccin-mocha` becomes the boot default _and_
the merge floor for partial external themes; Pi's `setTheme`/`onThemeChange`/`setRegisteredThemes` API drives all
runtime swaps so every existing UI module re-renders automatically through the shared `globalThis` theme key.

On boot, register the embedded theme, then conditionally lazy-discover external themes only when
`settings.theme !== "catppuccin-mocha"` (the 95%-fast-path rule). External themes are loaded from packages already
present in `settings.packages` (hand-edited at this slice — `hns install`/`remove` lands in slice 2). Each external
theme's `colors`/`vars` are merged on top of the embedded JSON before Pi validates, so a partial theme on disk becomes a
complete theme in memory and missing tokens fall back to catppuccin-mocha. Any external theme named `catppuccin-mocha`
is dropped at registration time (builtin precedence) with a one-line warning. Malformed JSON is skipped with a warning,
never crashes boot.

The `/theme` command opens a `SelectList` of `getAvailableThemes()` (which includes registered externals + the embedded
default). `onSelectionChange` calls `setTheme(name)` — Pi's existing `onThemeChange` callback drives the live re-skin,
no Harns-side debounce. Enter persists `settings.theme` to the global scope; Esc calls `setTheme(originalName)` to
revert. Also wired as a non-interactive CLI form: `hns theme <name>` switches + persists in one shot; `hns theme --list`
prints available themes.

**Acceptance criteria**

- [ ] Cold boot with no `settings.theme` renders catppuccin-mocha; `/theme` lists only `catppuccin-mocha`; no
      perceptible boot regression.
- [ ] With a hand-added `settings.packages` entry pointing at a local theme pack, `/theme` lists the external theme and
      arrow-down live-previews it instantly.
- [ ] Pressing Enter in `/theme` persists the choice to `~/.hns/settings.json`; restarting Harns boots into that theme.
- [ ] Pressing Esc in `/theme` reverts the TUI to the previously-persisted theme.
- [ ] An external theme named `catppuccin-mocha` is silently dropped (one warning line) and the embedded one is shown
      instead.
- [ ] An external theme missing some color tokens loads successfully by inheriting the missing tokens from
      catppuccin-mocha.
- [ ] A malformed theme JSON on disk does not crash boot or the picker — it is skipped with a warning, and other themes
      still register.
- [ ] `hns theme <name>` and `hns theme --list` work as documented from the shell.

#### Task 2 — `hns install` / `hns remove` CLI

**What to build**

Two new CLI commands wrapping Pi's `PackageManager` so users can manage theme packages without hand-editing
`settings.json`. Source forms accepted: `npm:<spec>`, `git:<url>`, `local:<path>` — Pi already parses these.

`hns install <source>` calls `PackageManager.installAndPersist(source)`, then calls `discoverAndRegisterThemes()` (from
slice 1) to refresh the in-process theme registry. The command prints a summary of the `.json` themes detected in the
package plus one line noting that any non-theme resources (extensions/skills/prompts) in the package were ignored — so
users aren't surprised that a "theme pack" also contained logic files that did nothing.

`hns remove <source>` calls `PackageManager.removeAndPersist(source)`. If the removed package owned the currently-active
theme (i.e., `settings.theme` is no longer resolvable after removal), reset `settings.theme` to `catppuccin-mocha` and
call `setTheme("catppuccin-mocha")` so any in-process TUI re-skins immediately.

Both commands register through the standard `src/cmd/registry.js` pattern: CLI-only (not slash), with the constants
added to `COMMAND_NAMES`. The slicer should confirm `INSTALL`/`REMOVE` names don't already collide before adding them.

**Acceptance criteria**

- [ ] `hns install local:./fixtures/sample-theme-pack` (fixture containing one `.json` theme and one `.ts` extension)
      succeeds; output reports the theme as installed and the non-theme resource as ignored.
- [ ] After install, `/theme` immediately lists the new theme without a Harns restart.
- [ ] `hns remove local:./fixtures/sample-theme-pack` succeeds; the package is gone from `settings.packages`.
- [ ] Removing the package that owns the active theme resets `settings.theme` to `catppuccin-mocha` and updates the live
      TUI.
- [ ] `npm:` and `git:` source forms parse and install correctly (smoke test with one real package each).
- [ ] Errors from `PackageManager` (network failure, invalid source, missing local path) surface to the user with a
      clear message and do not corrupt `settings.packages`.

#### Task 3 — Document new commands and settings keys

**What to build**

Update user-facing documentation to reflect the new theme system. Surfaces to document:

- The `/theme` slash command (interactive picker behavior, Enter/Esc semantics, live preview).
- The `hns theme <name>` and `hns theme --list` CLI forms.
- The `hns install <source>` and `hns remove <source>` CLI commands, including the three accepted source forms (`npm:`,
  `git:`, `local:`) and the explicit notice that **non-theme resources in installed packages are silently ignored** —
  this is the PRD's restriction surface and authors of theme packages need to know.
- The two new `settings.json` keys: `theme` (string, name of active theme) and `packages` (Pi's `string | object` schema
  — adopted verbatim from upstream).
- A short note in the README that the embedded `catppuccin-mocha` theme is always available as a fallback and wins any
  name collision with external themes.

No new top-level docs file is required if existing structure (README + per-command help text in the registry) suffices;
prefer threading docs into the existing surface.

**Acceptance criteria**

- [ ] Each new command has a clear, accurate entry in its `commandRegistry` definition (`summary`, `usage`, `notes`)
      matching the implemented behavior.
- [ ] README (or the equivalent user-facing doc) describes the `/theme` picker UX, the install/remove CLI, and the
      settings.json shape.
- [ ] The "non-theme resources are ignored" rule is documented in at least one user-visible place (likely
      `hns install --help`).
- [ ] No documentation refers to the PRD's `theme/catppuccin-mocha.json` path — the embedded JSON lives at
      `src/shared/ui/catppuccin-mocha.json` and is an implementation detail not exposed to users.

## Verification Plan

**Automated:**

- `deno test src/shared/ui/` — add unit tests for:
  - `discoverAndRegisterThemes()` registers external themes from a fixture package directory.
  - Name collision: an external theme named `catppuccin-mocha` is dropped; the embedded one wins.
  - Missing-token fallback: an external theme missing `mdHeading` merges with catppuccin-mocha and resolves `mdHeading`
    to the embedded value (no throw).
  - Malformed theme JSON: skipped with a console warning; other themes still register.
- `deno test src/cmd/theme/` — unit tests for `runThemeCommand`:
  - `hns theme <name>` persists `settings.theme` and calls `setTheme`.
  - Removing the active theme's package resets `settings.theme` to `catppuccin-mocha`.

**Manual:**

1. Cold boot with no `settings.theme` set → TUI renders with catppuccin-mocha; `/theme` opens picker showing only
   `catppuccin-mocha`.
2. `hns install local:./fixtures/sample-theme-pack` (a fixture dir with one `theme.json` + one `extension.ts`) → install
   succeeds, the `.ts` is reported as ignored, `/theme` now lists the new theme.
3. Open `/theme`, arrow-down to the new theme → TUI re-skins instantly (no perceptible lag). Press Esc → reverts to
   catppuccin-mocha.
4. Repeat (3) and press Enter → choice persists to `~/.hns/settings.json`. Restart Harns → loads with the chosen theme.
5. Manually corrupt the active theme's JSON on disk → restart Harns → falls back to catppuccin-mocha with a one-line
   warning; does not crash.
6. `hns remove local:./fixtures/sample-theme-pack` while that pack's theme is active → active theme resets to
   catppuccin-mocha.

**Expected results:** Live preview is visually instant; persisted theme survives restart; the embedded theme is never
absent from `/theme`; no boot-time regression for users who never set `settings.theme`.

## Edge Cases & Considerations

- **Name collisions.** External theme named `catppuccin-mocha` is dropped at registration time (not at install time —
  install accepts it, registration filters). Mitigation: log one warning line per dropped theme so package authors know.
- **Partial themes.** External theme JSON missing required `colors` tokens is normally rejected by Pi's schema
  validator. We override this by **merging** external `colors`/`vars` over the embedded catppuccin-mocha JSON _before_
  handing to Pi's loader — Pi then sees a complete theme. This means the file on disk can be partial; the in-memory
  object Pi validates is always complete. Risk: a partial theme silently inherits unexpected colors. Mitigation: in
  `/theme` picker, mark partial themes with a "(inherits N tokens)" suffix in the description so users know.
- **Persisted theme references a missing package.** On boot, `applyPersistedTheme()` lazy-discovers, fails to resolve
  the name, and stays on embedded with a one-line warning. The `settings.theme` value is _not_ rewritten — if the user
  reinstalls the package later, it just works.
- **Logic resources in theme packages.** Pi's `PackageManager.resolve()` returns extensions/skills/prompts; we ignore
  them entirely. They still get _downloaded_ to the package cache (that's how npm/git installs work), but Harns never
  registers or executes them. This is the PRD's restriction surface; document it in `hns install --help`.
- **Boot cost for users with a custom persisted theme.** Lazy discovery only runs when
  `settings.theme !== "catppuccin-mocha"`, so the default-theme user pays nothing. A user with a custom theme pays one
  `PackageManager.resolve()` call at boot — acceptable.
- **Theme-watcher on disk edits.** Pi's `startThemeWatcher` (in `theme.ts`) is opt-in via the second arg to
  `initTheme`/`setTheme`. PRD lists "manual editing of theme JSON files within the TUI" as out of scope, but the
  file-watcher is useful for theme _authors_ editing externally. **Decision: leave it off by default** (PRD-aligned);
  revisit if there's demand.
- **`install`/`remove` command scope.** If wiring these in this PR is too large, ship `/theme` alone against any themes
  Pi's `PackageManager` already discovers from a pre-existing `settings.packages` (which a user could hand-edit).
  Splitting is cheap and preserves a useful intermediate ship state. Recommend scoping this PR to `/theme` + lazy
  discovery + embedded fallback; do `install`/`remove` as a follow-up so each PR stays reviewable.
- **Embedded theme location.** PRD lists `theme/catppuccin-mocha.json` as a new file; this plan diverges — the JSON is
  already at `src/shared/ui/catppuccin-mocha.json` and is already bundled into the binary by `scripts/compile.js`. Leave
  it in place. No file move, no compile-script change needed.
