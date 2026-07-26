---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Restructure and Apache-license the bundled frontend-framework Skill with convention-aware visual and UX design guidance inspired by Anthropic's frontend-design Skill."
affectedPaths:
    - "src/skills/frontend-framework/SKILL.md"
    - "src/skills/frontend-framework/ENGINEERING.md"
    - "src/skills/frontend-framework/UX-DESIGN.md"
    - "src/skills/frontend-framework/VISUAL-DESIGN.md"
    - "src/skills/frontend-framework/LICENSE.txt"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T17:11:07-04:00"
updatedAt: "2026-07-26T21:23:03.145Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
userVerificationNote: null
---

# Add Design Discipline to the Frontend Framework Skill

## Context

`src/skills/frontend-framework/SKILL.md` is currently a 319-line, model-invoked Skill that combines its own ordered
implementation loop with broad reference material for component architecture, styling, accessibility, responsive
behavior, UX states, performance, safety, testing, and browser verification. Frontend Engineer already owns the hard
execution contract for Plan reading, Skill loading, dev-server/browser preflight, Pair versus autonomous execution,
verification, repair, and Task Completion. The Skill's convention-first default is correct, but its duplicate loop
competes with that Agent Definition and its reference does not give agents strong design guidance when browser UI is
genuinely greenfield.

Anthropic's Apache-2.0
[`frontend-design` Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) supplies
useful visual-design discipline: ground choices in the subject and audience, make the primary composition a thesis, use
structure and typography intentionally, concentrate boldness in one signature element, match implementation complexity
to the chosen direction, and critique generic defaults before and after building. Those ideas must be incorporated
without applying unsolicited visual reinvention to ordinary fixes or established products.

The agreed design-basis rule is: discover and read the existing design system first; preserve and extend it when it
exists; use the creative greenfield branch when no coherent system exists; and leave behind a compact reusable design
system rather than a one-off page. An explicit redesign request may use the visual-direction branch, but the existing
system remains an input and migration constraint. Browser mechanics remain owned by the separate `agent-browser-use`
Skill.

## Objective

Turn `front-end-framework-use` into a lean, predictable on-demand technique and reference package for browser frontend
work, with progressively disclosed engineering, UX, and visual-design material. The resulting Skill must preserve
source-first and convention-first behavior, establish a reusable design foundation for greenfield work, point to the
browser Skill when browser technique is needed, avoid restating Frontend Engineer's hard execution contract, and pass a
written self-critique against the local `write-a-skill` guidance.

## Approach

Keep one model-invoked Skill so frontend technique remains automatically discoverable without adding another
always-loaded skill description. Make `SKILL.md` a compact reference index built around the leading word
**convention-first**, the design-basis decision, and strong conditional context pointers—not a second execution loop.
Move domain reference behind three co-located sibling files:

- `ENGINEERING.md` owns code architecture, routing, state, CSS, i18n, performance, testing, and browser-side safety.
- `UX-DESIGN.md` owns user goals, information hierarchy, interface copy, interaction/data states, forms, accessibility,
  responsive behavior, and content resilience.
- `VISUAL-DESIGN.md` owns greenfield or explicitly authorized visual direction, the reusable design-system seed, the
  design-plan/critique/build/critique sequence, and the strongest applicable Anthropic design principles.

Use direct, conditional context pointers so an agent reads only the references relevant to the current branch. Keep hard
instructions for sequencing implementation, dev-server/browser preflight, Pair checkpoints, repairs, validation, and
Task Completion in `src/agent-definitions/frontend-engineer.md`. Keep browser commands, session lifecycle, screenshots,
diagnostics, and browser-tool installation in `agent-browser-use`; this Skill should only point there when those
techniques are relevant.

Adapt Anthropic wording where its compact leading phrases improve predictability. License the complete
`src/skills/frontend-framework/` Skill package—including `SKILL.md` and every disclosed sibling reference—under Apache
2.0 with a nested `LICENSE.txt`. Put a concise notice in `SKILL.md` that the Skill is inspired by the linked Anthropic
source and licensed under Apache 2.0, and identify the upstream source in `VISUAL-DESIGN.md`. This nested exception does
not change the root RunWield license or the licensing of any other repository path. The upstream repository exposes no
`NOTICE` file at the reviewed location.

After the content is final, critique it against every applicable `write-a-skill` axis, correct discovered weaknesses,
and report the final assessment as execution evidence rather than adding a critique document that would become stale.

## Files to Modify

- `src/skills/frontend-framework/SKILL.md` — replace the long mixed body with a concise invocation description, Apache
  2.0/inspiration notice, convention-first design-basis rule, and conditional reference pointers, without duplicating
  Frontend Engineer's execution loop or escalation contract.
- `src/skills/frontend-framework/ENGINEERING.md` — receive and prune the durable frontend implementation reference now
  embedded in `SKILL.md`.
- `src/skills/frontend-framework/UX-DESIGN.md` — co-locate user-centered behavior, interface writing, accessibility,
  responsive, content, forms, and async-state guidance.
- `src/skills/frontend-framework/VISUAL-DESIGN.md` — add the attributed greenfield/authorized-redesign design process,
  reusable design-system seed, anti-template critique, and visual quality criteria.
- `src/skills/frontend-framework/LICENSE.txt` — license this complete Skill package under Apache 2.0 using the
  unmodified full license text supplied with Anthropic's source Skill.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/skills/write-a-skill/SKILL.md` and `src/skills/write-a-skill/GLOSSARY.md` — use the established vocabulary and
  rubric for invocation, information hierarchy, context pointers, co-location, granularity, completion criteria, leading
  words, pruning, and failure modes.
- `src/agent-definitions/frontend-engineer.md` — retain its existing Execution Contract as the single source of hard
  sequencing for Plan execution, Skill loading, browser preflight, collaboration style, verification, repair, and Task
  Completion; this Plan does not modify it.
- `src/skills/agent-browser/SKILL.md` — retain this as the single source of truth for headed-browser technique,
  screenshots, accessibility snapshots, interactions, diagnostics, worktree-safe sessions, and cleanup.
- `src/skills/prototype/SKILL.md` — follow its thin router plus branch-reference pattern without making the frontend
  references separately invocable Skills.
- `docs/design-system.md` and `src/ui/design-system/` — preserve the current RunWield-specific instruction to inspect
  the RunWield Design System before changing Workspace or other RunWield browser UI.
- `src/shared/session/agent-assets.js#copyTreeFromBundle` — existing recursive extraction already carries sibling files
  from the Skill directory into `~/.wld/bundled-skills`.
- `scripts/release-check.test.js` — existing bundled-Markdown inventory and extraction checks cover newly disclosed
  Markdown references without hard-coded additions.

## Implementation Steps

- [ ] Rewrite `src/skills/frontend-framework/SKILL.md` as a thin, primarily referential model-invoked Skill. Shorten its
      description while preserving genuine implementation/review and visual/UX trigger branches, front-load
      **convention-first**, and exclude TUI work. Keep only the design-basis invariant and a compact “read this when…”
      index into the sibling references. Remove the duplicate Feedback Loop and do not restate Frontend Engineer's
      dev-server, browser-preflight, Pair/autonomous, repair, validation, or Task Completion sequencing.
- [ ] Make design-system discovery the decision gate before visual invention. For an established formal or informal
      system, require agents to name and reuse its tokens, primitives, typography, layout, motion, and neighboring
      patterns. Treat an incomplete system as something to extend minimally, not automatically as greenfield. Enter the
      creative branch only when no coherent system exists or the User Request explicitly authorizes visual reshaping.
- [ ] Create `ENGINEERING.md` by moving and pruning the current implementation reference. Co-locate component/runtime
      boundaries, routing/navigation, state, styling and selector discipline, i18n, performance/assets/fonts, testing
      convention, and browser safety. Remove browser command details and UX/visual material now owned elsewhere. Give
      the reference an exhaustive branch-completion criterion.
- [ ] Create `UX-DESIGN.md` for all materially user-facing interaction branches. Cover the user's recognizable goal,
      information architecture, consistent action naming and plain interface copy, loading/empty/error/success and
      recovery states, forms, keyboard and semantic accessibility, reduced motion, responsive/container behavior,
      realistic and localized content, and preservation of user context through async transitions. Keep each concept's
      rules and caveats together and end with a checkable UX completion criterion.
- [ ] Create `VISUAL-DESIGN.md` for greenfield UI and explicitly authorized visual redesign. Adapt the source's
      strongest design language and process: ground the direction in a concrete subject, audience, real content, and
      single job; define a compact system for semantic color, type roles/scale, spacing/layout, components/states, and
      motion; identify one defensible signature element; compare short layout concepts; critique generic defaults before
      code; build from the chosen system; then critique screenshots and remove unsupported decoration. Require the
      greenfield result to leave reusable tokens/primitives or equivalent project-native foundations that later work can
      follow.
- [ ] Add `license: Apache-2.0; complete terms in LICENSE.txt` (or an equivalent valid skill-license declaration) and a
      concise visible notice to `SKILL.md`: this Skill is inspired by the exact Anthropic source supplied in the User
      Request and licensed under Apache 2.0. Add the unmodified full Apache 2.0 text as `LICENSE.txt`, make clear that
      the nested license covers the complete `src/skills/frontend-framework/` package only, and identify the adapted
      source in `VISUAL-DESIGN.md`. Preserve copied wording accurately, but revise source assumptions that conflict with
      convention-first work, RunWield's browser tooling, accessibility baseline, or reusable-design-system requirement.
- [ ] Replace duplicated browser prose with one strong conditional pointer to `agent-browser-use` for runs that need to
      exercise a real browser. Leave when to start/reconnect, how long to retain a worktree-scoped session, Pair
      evidence, final diagnostics, CLI commands, and browser-test-framework guardrails in the Frontend Engineer prompt
      or browser Skill that already owns them.
- [ ] Audit the complete Skill as one information hierarchy. Resolve every relative pointer, ensure each rule has one
      authoritative home, remove stale or generic no-op prose, convert avoidable negations into positive steering while
      retaining hard guardrails, and ensure branch files are reference rather than hidden mandatory steps.
- [ ] Critique the final result against `write-a-skill` and its glossary. Explicitly assess model invocation,
      description triggers/context load, leading words, branch granularity, progressive disclosure/context pointers,
      co-location, reference completion criteria/legwork, and the duplication, sediment, sprawl, no-op, and negation
      failure modes. Confirm that premature completion is not being addressed through a duplicate Skill loop and that
      hard sequencing remains in Frontend Engineer's prompt. Fix actionable findings before completion, then include a
      concise pass/adjusted/residual-risk critique in the execution report; do not create a permanent critique file.

## Verification Plan

- Automated: run
  `deno fmt --check src/skills/frontend-framework/SKILL.md src/skills/frontend-framework/ENGINEERING.md
  src/skills/frontend-framework/UX-DESIGN.md src/skills/frontend-framework/VISUAL-DESIGN.md`.
- Automated: run `deno test -A --no-check scripts/release-check.test.js` to confirm all disclosed Markdown is included
  in bundled-skill extraction checks.
- Static: verify every relative Markdown pointer from `SKILL.md` resolves within the extracted `frontend-framework/`
  directory, `LICENSE.txt` contains the complete upstream Apache 2.0 text, and the Skill's visible license notice scopes
  Apache 2.0 to this package without changing the root RunWield license.
- Scenario audit: trace a routine frontend bug fix; it must preserve the established design language, load only relevant
  engineering/UX reference, and avoid greenfield visual invention.
- Scenario audit: trace an extension in a project with an informal or partial design system; it must discover
  neighboring patterns and extend the smallest reusable foundation rather than declaring the project greenfield.
- Scenario audit: trace greenfield browser UI; before coding, the Skill must establish subject/audience/job, a compact
  reusable design system, a signature element, and a critique against generic defaults.
- Scenario audit: trace an explicitly requested redesign; the visual branch may activate, but the existing design system
  must be inspected and treated as a compatibility/migration input rather than ignored.
- Scenario audit: trace a user-facing form or async flow; the UX reference must cover copy, accessible semantics,
  responsive/content resilience, all relevant states, recovery, and preservation of user input/context.
- Scenario audit: trace visual implementation and review; the Frontend Engineer prompt must remain the source of hard
  execution sequencing, while browser technique resolves to `agent-browser-use`; neither contract is duplicated in this
  Skill.
- Expected result: the top-level Skill is materially shorter and easier to consult than the current 319-line file, while
  every live engineering/design rule remains reachable from exactly one well-worded context pointer.
- Expected result: `src/agent-definitions/frontend-engineer.md` is unchanged, and the frontend Skill complements rather
  than shadows its Execution Contract.
- Expected result: the final execution report contains the requested `write-a-skill` critique and identifies any
  consciously retained trade-off rather than claiming an unexamined perfect score.
- Execution policy matrix:
  - This is Skill documentation/prompt behavior, not browser-rendered product UI, so execution remains Engineer-owned
    and autonomous; no dev server or headed-browser verification is required for editing the Skill itself.
  - The implemented Skill continues to require real-browser verification for materially visual or interactive target
    project work unless externally blocked.

## Edge Cases & Considerations

- An informal system expressed only through neighboring components still counts as an existing design basis. The agent
  should infer and name it before adding values or primitives.
- A project can be greenfield in visual language while still having framework, accessibility, state, testing, or CSS
  conventions. The visual branch must not discard those engineering conventions.
- A user-supplied design brief overrides generic creative preferences, including when it intentionally asks for a common
  aesthetic. Distinctiveness is not permission to contradict explicit requirements.
- Greenfield creativity must establish a followable system without forcing a large standalone design-system package or
  documentation artifact when project-native tokens and primitives are sufficient.
- Explicit redesign can change visual language, but broad migration of unaffected screens remains outside scope unless
  the User Request or approved Plan includes it.
- Visual boldness should be concentrated and defensible; accessibility, responsive behavior, focus visibility, reduced
  motion, content clarity, and product usability remain baseline quality requirements rather than optional style axes.
- Keep framework examples current enough to aid recognition but avoid exhaustive framework or trend lists that create
  sediment. Use `ketch` when implementation behavior depends on current external documentation.
- Do not add a separate visual-design Skill: that would add model-invoked context load and create competing frontend
  ownership. The disclosed files remain on-demand reference under `front-end-framework-use`.
- Do not turn the Skill into an alternate Frontend Engineer prompt. Agent identity, approved-Plan execution, worktree
  and dev-server lifecycle, Pair/autonomous behavior, validation, repair, and Task Completion remain prompt-owned hard
  instructions.
- The external GitHub URL is provenance, not a Ticket Reference, and must not be added to Plan Front Matter.
- The nested Apache 2.0 license applies to every file in `src/skills/frontend-framework/` and no other RunWield path;
  the rest of the codebase remains under the normal root RunWield license.
- Existing unrelated dirty files in the working tree must remain untouched.
