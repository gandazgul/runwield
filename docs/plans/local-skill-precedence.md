---
planId: "e8781b46-e323-405e-b6b0-f3d75ed79355"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/skill-catalog.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/named-invocation.ts"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/session/named-invocation.test.ts"
    - "src/shared/session/session-prompt.test.js"
    - "docs/prd/runwield-core-prd.md"
    - "docs/customization.md"
    - "docs/settings.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-21"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
status: "validated"
validatedCommit: "e33ab410ab32a1b1a2a2b522d24ab6233e2d96c8"
workRecord:
    status: "generated"
    recordId: "fcaed561-4d2c-487c-afb2-6f6871f53aee"
    path: "docs/work-records/2026-09-21-unified-local-skill-discovery-and-precedence.md"
    lastAttemptAt: "2026-09-21T20:51:23.715Z"
---

# Shared Core Skill Loading and Local External Skills

## Context

RunWield does not load project `.agents/skills/`. Skill listing and named invocation each implement their own discovery
rules. Pi's resource loader also discovers skills and can append them to the model's system prompt.

The owner wants local external skills, while keeping built-in customization explicit through `.wld`. Discovery and
`/skill:` lookup must use the exact same Core functions. Pi skills must be ignored entirely.

Owning capability: [Agent and skill customization](../prd/runwield-core-prd.md#agent-and-skill-customization). Change
**Skills and integrations** under **Respect user customization while retaining workflow capabilities** to describe the
new order and bundled-name exclusion. Add acceptance scenarios for project external skills, intentional bundled
customization, and disabling external skills. Preserve on-demand full instructions, built-in command reservation, and
Skill invocation without changing the Agent profile. Agent and Prompt Template precedence do not change.

## Objective

One Core implementation selects the skills used by listing, model advertising, and invocation:

```text
project .wld/skills
  > project .agents/skills
  > home ~/.wld/skills
  > home ~/.agents/skills
  > bundled
```

Before applying this order, exclude skills from either `.agents` folder whose names conflict with a bundled skill. Both
project and home `.wld` skills can override bundled skills. With `enableExternalSkills: false`, neither `.agents` folder
participates: project `.wld` > home `.wld` > bundled.

## Approach

Put skill discovery, metadata parsing, exclusion, winner selection, name lookup, and expansion in a small Core module,
proposed as `src/shared/session/skill-catalog.ts`. It must not import `session.js` or own Session state.

```text
Core skill catalog
  listSkills compatibility export -> runtime lists, Workspace options, system prompt
  shared skill lookup + expansion -> expandSkillCommand and resolveNamedInvocation
```

Load bundled metadata first to establish protected names, but apply the owner's order to eligible candidates. Keep the
extracted bundled cache preferred over the bundled source fallback. Use the same selected records for all consumers;
sharing only a directory array while keeping two scanners is not sufficient.

A skill's effective name is its trimmed Front Matter `name`, falling back to its directory name. Match duplicate
published names as well as the existing directory identity. Keep directory-name invocation aliases for selected skills.
External candidates must not bypass bundled protection through a different directory with the same declared name, or
through an existing directory alias. Excluded candidates must not reserve a name or block a lower eligible candidate.
Keep current source values: both `.agents` locations use `external`; their exact paths identify scope.

The owner explicitly requires ignoring Pi skills altogether. RunWield already advertises skills in its composed prompt
and resolves named invocations in Core. Disable Pi's skill discovery/expansion catalog in `buildAgentSession`, using the
installed loader's supported options. Do not merge or import Pi-discovered, package, extension, or configured skill
resources into Core. `noSkills` alone may still admit explicitly configured paths; keep Pi's resulting skill list empty
with its supported `skillsOverride` option, including reload. This must not disable RunWield's own catalog, prompts,
extensions, or on-demand Skill invocation. Do not modify Pi source.

The alternative of separate scanners is rejected by the owner: a shared directory list alone cannot keep collision and
exclusion behavior consistent. This change follows existing Core ownership in
[ADR-010](../adr/010-session-runtime-sibling-adapters-and-acp.md); no new architectural owner or ADR is needed.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/skill-catalog.ts` and focused tests — one real implementation of loading, selection, lookup, and
  expansion.
- `src/shared/session/session.js` — retain existing public exports as delegates; remove its scanner/expansion copy and
  prevent Pi from advertising or invoking another catalog.
- `src/shared/session/named-invocation.ts` — remove `findSkillResource`'s independent scan and duplicate expansion;
  consume shared Core results while retaining durable invocation payload behavior.
- `session-catalog.test.js`, `named-invocation.test.ts`, `session-prompt.test.js` in that directory — real filesystem
  precedence tests and a model-boundary regression test. Extend existing runtime tests if needed for reload.
- `docs/prd/runwield-core-prd.md`, `docs/customization.md`, `docs/settings.md` — requirements, acceptance scenarios,
  complete precedence, and the setting's two-folder scope.
- `src/skills/runwield/CUSTOMIZATION.md`, `docs/themes.md`, `docs/user-facing-features.md` — correct active
  skill-loading descriptions. Do not rewrite historical Work Records or unrelated dirty Plans.

No browser redesign, installation changes, new settings, symlink support, or Agent/Prompt Template loading changes. The
existing glossary definition of Skill remains accurate; no new domain term is introduced.

## Reuse Opportunities

- `agent-assets.js:extractBundledSkills` — runtime-readable cache and source fallback; no replacement extraction system.
- `getHomeDir`, explicit caller `cwd`, and `getCustomSetting` — preserve home resolution and per-Project isolation.
- Existing invocation payload creation and expansion formatting — preserve compact history, exact saved expansion,
  additional instructions, and relative-reference paths.
- `withRuntimeCommandFixture` and `withProcessGlobalTestLock` — real isolated files/settings and a fake model boundary;
  no injection hooks for owned discovery logic.

## Implementation Steps

1. The Core catalog returns exactly the eligible winners in the stated order. It reads local `.agents` skills, excludes
   external bundled-name conflicts before selection, and omits both external folders when disabled. It retains metadata,
   directory aliases, and readable absolute paths. Missing or unreadable candidates follow the existing catalog's skip
   behavior and do not reserve names.
2. `listSkills`, `expandSkillCommand`, and `resolveNamedInvocation` use that catalog's functions. The old filesystem
   scans, precedence decisions, metadata parsing, and Skill expansion copies no longer exist in their callers. Existing
   imports remain compatible. Unknown skills still throw from `expandSkillCommand` and return `ordinary` from named
   invocation. Skill payloads retain the selected source and exact expansion without Agent/model changes.
3. The real built Agent Session advertises only Core's eligible skills. Pi cannot append excluded or disabled skill
   paths, expand them through a second catalog, or restore them during reload. RunWield listing and invocation still
   work.
4. Behavioral tests prove the selection matrix below through the public listing and invocation paths, plus the actual
   model-facing prompt. Existing supported invocation and prompt behavior remains covered after extraction.
5. The owning PRD capability, its acceptance scenarios, and active documentation describe the delivered rules in the
   same change. Unrelated target/deferred requirements remain unchanged.

## Approval Confirmation

No Work Records are proposed for supersession.

## Verification Plan

Use actual temporary directories with distinct descriptions and bodies for each layer. Use bundled `research` (or
another real bundled skill) for protection cases; do not write fake assets into repository bundled sources. Test all
three entry points: `listSkills`, `expandSkillCommand`, and `resolveNamedInvocation`. Assert selected path, source,
unique advertised name, and expanded body, not just list order.

| Scenario                                                                                 | Required result                                                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Non-bundled name in all four custom layers; remove each winner in turn                   | Project `.wld`, project `.agents`, home `.wld`, then home `.agents` win in that order.                    |
| Unique skill only in project `.agents`                                                   | Listed, advertised, and invoked from that exact file.                                                     |
| Bundled name with conflicting copies in both `.agents` folders, no `.wld` copy           | Only bundled is advertised/invoked; external descriptions and paths are absent.                           |
| Same bundled name also in home `.wld`, then project `.wld`                               | Home `.wld` wins despite project `.agents`; project `.wld` wins when added.                               |
| External folder name differs but declared name matches bundled                           | External record is ignored, including invocation through its directory alias.                             |
| Directory alias matches bundled but declared name differs                                | External record cannot bypass bundled-name protection.                                                    |
| Same declared non-bundled name across layers with different directory names              | One advertised winner; lookup by that name and its winning directory alias agrees.                        |
| External loading disabled, with unique external files and colliding `.wld`/bundled files | Both external locations absent; project `.wld` > home `.wld` > bundled; external-only lookup is ordinary. |
| Two Project roots, missing folders, or missing caller `cwd`                              | No cross-Project leakage, no error for absent folders, no implicit project scan without `cwd`.            |

Additional checks:

- Through `withRuntimeCommandFixture`, build/run a real Agent Session and capture the actual model context. Assert that
  the winning skill path appears once and excluded/disabled paths do not appear. Include a home `.wld` skill and a
  conflicting external skill to catch Pi's independent discovery. Repeat after `/reload` through the runtime path.
- Add a Pi-only skill through a configured Pi skill path using the installed settings format, outside all five Core
  locations. Verify that Pi's loader returns no skills, before and after reload; its name/path/body never enters Core
  listing, the effective model prompt, or slash-command expansion. Confirm the fixture is a valid resource that an
  unrestricted Pi loader would discover, so an invalid fixture cannot give a false pass.
- With external loading disabled, submit an external-only `/skill:` request through the real turn path. Its body must
  not reach the model through Pi fallback. A selected Core Skill must still expand and retain its compact invocation and
  exact saved expansion.
- Preserve tests for local `.wld` loading, readable bundled cache paths, additional instructions, unknown skill errors,
  `disable-model-invocation` (hidden from model advertising but explicitly invocable), Agent profile preservation, and
  durable invocation restore. Former external-only-home setting coverage must now cover both locations.
- Semantic Review: trace both listing and named invocation into the same implementation. Reject duplicated scans,
  parsing, expansion, or filters even if their tests pass, including copies moved into the same new file. Merely moving
  both scanners would pass behavioral tests but would violate the owner's shared-function requirement. Check that no
  consumer re-sorts candidates or applies different winner rules.
- The project-external test fails before this change. The bundled-name tests reject a simple five-layer reorder. The
  actual model-context test rejects a catalog-only fix that leaves Pi's second list active.

Commands:

```sh
deno run -A scripts/run-tests.js src/shared/session/skill-catalog.test.ts src/shared/session/session-catalog.test.js src/shared/session/named-invocation.test.ts src/shared/session/session-prompt.test.js src/shared/session/named-invocation-active-segment.integration.test.ts
deno task check
deno task lint
deno task seams:check
deno task doc-links:check
deno task skills:sync:check
deno task test
```

Adjust the focused test filename if the implementation uses the existing test files instead of a new one. Never run
`deno test` directly. Tests that change HOME or cwd must hold `withProcessGlobalTestLock`; all files/settings belong to
the sandbox. Verify documentation against tested behavior rather than claiming that updated prose proves completion.

## Edge Cases & Considerations

- Some bundled directory names differ from their declared names. Protection must use real metadata and supported
  aliases, not a hard-coded list or directory names alone.
- Bundled protection is independent of whether a `.wld` override exists. Ignoring an external conflict must not make a
  bundled name unavailable or block its `.wld` override.
- Keep discovery fresh on subsequent calls/reload. Do not cache winners across Projects or settings changes. Reuse
  bundled extraction as-is; avoid expanding this into a cache redesign.
- Keep current direct-child directory discovery. Following symlinked skill directories and changing malformed-file
  diagnostics are outside this request.
- This changes precedence intentionally: project external skills can override home `.wld` skills only for non-bundled
  names. Explain the exception clearly in documentation.
