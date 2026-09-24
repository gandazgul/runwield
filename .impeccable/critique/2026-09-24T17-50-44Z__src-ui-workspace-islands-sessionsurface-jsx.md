---
target: the Session screen
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
target_identity: "file:/Users/gandazgul/Documents/web/runwield/src/ui/workspace/islands/SessionSurface.jsx"
target_fingerprint: "sha256:f2901f157410824d45e8c2a4addb5c3c5d9ba1e80e7f38774de86400b4db8bbb"
target_path: /Users/gandazgul/Documents/web/runwield/src/ui/workspace/islands/SessionSurface.jsx
timestamp: 2026-09-24T17-50-44Z
slug: src-ui-workspace-islands-sessionsurface-jsx
---

# Session screen critique

Target: `src/ui/workspace/islands/SessionSurface.jsx`. Method: delegated source review preceded parent-run browser and
detector checks because delegated reviewers could not access those tools. Browser evidence used the static dev fixture,
not live Project data.

## Design health — 26/40 (Acceptable)

| #         | Nielsen heuristic               |     Score | Main issue                                      |
| --------- | ------------------------------- | --------: | ----------------------------------------------- |
| 1         | Visibility of System Status     |         3 | Live work not available in fixture.             |
| 2         | Match System / Real World       |         3 | Product-specific language.                      |
| 3         | User Control and Freedom        |         3 | Composer and sidebar open/close.                |
| 4         | Consistency and Standards       |         3 | Shared Workspace patterns.                      |
| 5         | Error Prevention                |         3 | Empty Send disabled.                            |
| 6         | Recognition Rather Than Recall  |         2 | Collapsed composer does not look like an input. |
| 7         | Flexibility and Efficiency      |         3 | Slash commands and selectors.                   |
| 8         | Aesthetic and Minimalist Design |         3 | Clear existing workbench, blank new screen.     |
| 9         | Error Recovery                  |         2 | Fixture could not test failed send.             |
| 10        | Help and Documentation          |         1 | No visible guidance on New Session.             |
| **Total** |                                 | **26/40** | **Acceptable**                                  |

## Design specificity

The conversation and Workflow/Session/Artifacts panel are specific to RunWield and fit its compact dark review surfaces.
New Session is too blank to communicate that purpose. Source detector: zero findings in `SessionSurface.jsx`. Browser
detector: one sidebar mint brand-rail stripe, intentional by `docs/design-system.md`, so a false positive. Injection and
overlay appeared in the browser and were removed before interaction checks.

## Overall impression

The existing Session is a focused workbench, but the blank New Session screen offers no visible invitation to start.

## Strengths

- Conversation remains primary; context is separate.
- Compact styling fits review surfaces.
- Covered mobile conversation is correctly removed from keyboard navigation while context is open.

## Priority issues

1. **P1 — Blank New Session.** At desktop and phone sizes the work area is empty, with only a compact composer at the
   bottom. Add a visible first-step invitation while preserving direct typing. The PRD's intent choices are a goal, not
   observed fixture behavior. Suggested command: `$impeccable onboard`.
2. **P2 — Composer purpose hidden.** Its collapsed row names Agent/model/Thinking rather than the message action; add a
   writing cue without losing compact settings context. Suggested command: `$impeccable clarify`.
3. **P2 — Phone settings labels clipped.** At 390px the selected Agent, Model, and Thinking controls are about 66, 99,
   and 66px; their full values appear only in native selection or tooltip. Keep current values readable without
   horizontal overflow. Suggested command: `$impeccable adapt`.
4. **P2 — Context tab semantics incomplete.** ArrowRight from Session leaves focus and selection unchanged, all tabs
   have tabIndex 0, and tabs lack aria-controls. Match expected keyboard behavior and panel relationships. Suggested
   command: `$impeccable harden`.

## Cognitive load and emotional journey

Two checklist failures: weak first-step hierarchy and five simultaneous controls in the expanded phone composer.
Moderate load. Draft preservation helps confidence, but the blank start increases uncertainty before any message is
sent.

## Persona red flags

- Jordan, first-time developer: no visible prompt to begin on New Session.
- Casey, phone user: selected values clipped; must open picker to confirm.
- Sam, keyboard user: role=tab implies arrow navigation, but ArrowRight does not move between tabs.

## Minor observations

The static fixture has only a short conversation. Long histories, active workflow, failed-send recovery, and production
performance were not assessed. No horizontal overflow at 390px. The prior mobile covered-focus bug is fixed and not a
current finding.

## Questions to consider

- Should New Session teach the first task with intent choices, a direct writing cue, or both?
- Should the selected Agent/model/Thinking be fully visible in the composer, or in a compact adjacent disclosure?
- Which context tab keyboard behavior best matches the existing review surfaces?
