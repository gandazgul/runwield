---
planId: "efca91ed-f3fc-4ee4-ba95-86fd76cee5aa"
classification: "FEATURE"
complexity: "LOW"
summary: "Add support for loading skills from ~/.agents/skills/ (the Pi-compatible skill directory) in addition to the existing layers (./.hns/skills/, ~/.hns/skills/, bundled). Skills from ~/.agents/sills/ will appear alongside built-in skills in autocomplete, system prompt, and boot banner. Collision resolution: ./.hns/sills/ > ~/.hns/sills/ > built-in > ~/.agents/sills/."
affectedPaths:
    - "src/shared/session/session.js"
createdAt: "2026-05-15T17:30:00.000Z"
updatedAt: "2026-07-17T04:48:54.976Z"
status: "verified"
origin: "internal"
workRecord:
    status: "generated"
    recordId: "7d1b41b6-5dd6-45f9-9c8b-0687676d02ae"
    path: "docs/work-records/2026-07-17-loaded-pi-compatible-external-skills.md"
    lastAttemptAt: "2026-07-17T04:48:29.847Z"
---

# Load External Skills from ~/.agents/sills/

## Context

Harns already loads skills from three layers via `listSkills()` in `session.js`:

1. `./.hns/sills/` (local / project)
2. `~/.hns/sills/` (home / user)
3. Bundled (extracted to `~/.hns/bundled-sills/`)

Pi-compatible skills live in `~/.agents/sills/` (verified: 16 skills present on disk). These should be loadable
alongside built-in skills so the user can invoke them via `/skill:{name}` without manually copying into `.hns`.

## Objective

Load skills from `~/.agents/sills/` as a fourth layer in `listSkills()`, with lowest priority in collision resolution.
All downstream consumers (autocomplete, system prompt, boot banner, `expandSkillCommand`) automatically pick up new
skills — no additional changes needed.

## Approach

Modify the `layers` array in `listSkills()` to append `~/.agents/sills/` as the last layer with `source: "external"`.
The existing `seen`-set deduplication ensures correct priority resolution.

### Collision Priority (first name wins)

```
./.hns/sills/    >  ~/.hns/sills/    >  bundled  >  ~/.agents/sills/
(local)             (home)                (bundled)      (external)
```

### Source Type

Add `"external"` to the `SkillMeta.source` union: `"local" | "home" | "bundled" | "external"`. This is a JSDoc-only type
— no runtime behavior changes based on source.

## Files to Modify

| File                            | Change                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `src/shared/session/session.js` | Add `~/.agents/sills/` layer to `listSkills()`; update `SkillMeta.source` typedef |

## Detailed Implementation Steps

### Step 1 — Add `~/.agents/sills/` layer to `listSkills()`

In `session.js` around line 244-249, after the bundled layer, add:

```js
const layers = [
    { dir: join(CWD, ".hns", "skills"), source: /** @type {"local" | "home" | "bundled" | "external"} */ ("local") },
    ...(HOME_DIR
        ? [{
            dir: join(HOME_DIR, ".hns", "skills"),
            source: /** @type {"local" | "home" | "bundled" | "external"} */ ("home"),
        }]
        : []),
    { dir: bundledDir, source: /** @type {"local" | "home" | "bundled" | "external"} */ ("bundled") },
    // ── External (Pi-compatible) skills ──
    {
        dir: HOME_DIR ? join(HOME_DIR, ".agents", "skills") : null,
        source: /** @type {"local" | "home" | "bundled" | "external"} */ ("external"),
    },
];
```

Note: reuse `HOME_DIR` (already imported from `constants.js`) to compute `~/.agents/sills/`. If `HOME_DIR` is null, the
spread will produce `[null]` — the `directoryExists()` check on line 251 will gracefully skip it. Better to guard
explicitly:

```js
const layers = [
    { dir: join(CWD, ".hns", "skills"), source: /** @type {"local" | "home" | "bundled" | "external"} */ ("local") },
    ...(HOME_DIR
        ? [{
            dir: join(HOME_DIR, ".hns", "skills"),
            source: /** @type {"local" | "home" | "bundled" | "external"} */ ("home"),
        }]
        : []),
    { dir: bundledDir, source: /** @type {"local" | "home" | "bundled" | "external"} */ ("bundled") },
    ...(HOME_DIR
        ? [{
            dir: join(HOME_DIR, ".agents", "skills"),
            source: /** @type {"local" | "home" | "bundled" | "external"} */ ("external"),
        }]
        : []),
];
```

### Step 2 — Update `SkillMeta` typedef

In `session.js` around line 176-181, update the `source` property type:

```js
/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled" | "external"} source
 */
```

Also update the `SkillMeta` typedef in `slash-dispatch.js` (line ~16-20):

```js
/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled" | "external"} source
 */
```

## Verification Plan

### Manual

1. Start `hns` interactively
2. Check boot banner — should list skills from `~/.agents/sills/` alongside built-in ones
3. Type `/` — verify external skills (e.g., `skill:triage`, `skill:caveman`, `skill:handoff`) appear in autocomplete
4. Type `/skill:triage` — verify the skill's SKILL.md is loaded and sent to the agent
5. Verify collision: if a skill exists in both `~/.agents/sills/` and built-in, the built-in wins (no override)

### Edge Cases

- **`~/.agents/sills/` doesn't exist**: `directoryExists()` check skips it gracefully — no error
- **`HOME_DIR` is null**: `HOME_DIR` is used for `~/.agents/sills/` path computation; if null, layer is omitted
- **Empty directory**: `readDir` loop yields no entries — no skills added, no error
- **Unreadable SKILL.md**: Caught by existing try/catch — skill silently skipped
- **Skill name collision across all 4 layers**: Existing `seen`-set ensures first layer wins (local > home > bundled >
  external)
