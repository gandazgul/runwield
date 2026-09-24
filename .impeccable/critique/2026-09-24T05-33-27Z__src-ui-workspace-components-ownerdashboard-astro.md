---
target: Workspace dashboard
total_score: 24
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
target_identity: "file:/Users/gandazgul/Documents/web/runwield/src/ui/workspace/components/OwnerDashboard.astro"
target_fingerprint: "sha256:cda7dc8f45a39ad47421abfa071f1ac02a20f98df61d55989a3bc3b2f423d9a3"
target_path: /Users/gandazgul/Documents/web/runwield/src/ui/workspace/components/OwnerDashboard.astro
timestamp: 2026-09-24T05-33-27Z
slug: src-ui-workspace-components-ownerdashboard-astro
---

# Attention Dashboard critique

## Design Health Score

| #         | Heuristic               |                  Score | Key Issue                                                             |
| --------- | ----------------------- | ---------------------: | --------------------------------------------------------------------- |
| 1         | System status           |                      2 | Load/error states exist; freshness and incomplete counts are unclear. |
| 2         | Real-world language     |                      3 | Section names are clear; every row says “Open.”                       |
| 3         | User control            |                      3 | Sort and expansion work; page has no direct retry.                    |
| 4         | Consistency             |                      3 | Shared styles; four equally weighted cards weaken priority.           |
| 5         | Error prevention        |                      2 | Partial data can look like a definitive zero.                         |
| 6         | Recognition over recall |                      2 | Rows name Plans but not their specific next actions.                  |
| 7         | Efficiency              |                      2 | Fast triage needs opening Plans for decisions and time context.       |
| 8         | Minimalism              |                      3 | Compact layout; equal cards and repeated Open waste emphasis.         |
| 9         | Error recovery          |                      2 | Warning links to settings; fetch error has no explicit retry.         |
| 10        | Help                    |                      2 | No inline explanation of time-based sorting or section scope.         |
| **Total** |                         | **24/40 — Acceptable** | **Prioritize decision clarity.**                                      |

## Design Specificity

The Plan-first categories and current review status belong to RunWield, but four identical cards and identical Open
actions could belong to a generic task dashboard. The layout follows the design system's dark, compact surfaces yet
misses its instruction to prioritize current work and evidence. The CLI detector returned `[]` for OwnerDashboard.astro.
The injected page detector reported 5 anti-patterns: four `gpt-thin-border-wide-shadow` on section cards and one
`side-tab` involving the sidebar/brand rail. The card rule overlaps the visual impression of redundant boxed sections,
although the shadow is a shared deliberate style; the sidebar stripe is a deliberate design-system brand treatment, so
neither finding alone proves a defect. An overlay was visible temporarily in the headed browser; that browser was closed
afterward.

## Overall impression

It is readable and calm, but it does not tell an experienced developer what to do first. The next action should dominate
the page instead of four equal containers.

## Strengths

- The four workflow categories give a quick map of current work; titles precede metadata.
- Compact typography and restrained colors match the review surfaces without marketing-page decoration.
- On a 390×844 viewport, long titles wrap and row links remain legible; the section layout does not overflow
  horizontally.

## Priority issues

1. **P1 — Every Plan links with the same “Open” action.** A review, recovery and finished Plan appear to require the
   same action. Replace the repeated action text with a specific next-step label, such as “Review Plan,” “Resume
   recovery,” or “View outcome,” while keeping the whole row linked to the owning workflow; preserve the distinction
   between approval and execution. Suggested command: `$impeccable clarify`.
2. **P2 — Four equal cards flatten urgency.** At 1440×900, Needs You and Recently Finished get equal space, borders and
   weight. On a 390×844 phone, Recently Finished falls below the initial view after three similar cards. Give Needs You
   clear priority and make finished work more compact/secondary without burying it. Suggested command:
   `$impeccable layout`.
3. **P2 — Recent and sort lack visible time context.** A row in Recently Finished has no timestamp; in the live version
   “Newest first” gives no clue which timestamp orders items. Add a concise relevant time in the row and label the sort
   basis clearly. Keep titles and actions first. Suggested command: `$impeccable clarify`.
4. **P2 — Partial reads and empty sections communicate conflicting certainty.** The live component shows a Project
   warning but leaves zero counts and “Nothing here” unchanged. Readers can mistake missing data for confirmed absence.
   Mark the result as incomplete near its count or empty section and keep the Project settings recovery path. Suggested
   command: `$impeccable harden`.

## Persona red flags

- **Alex, experienced developer:** Scanning two Needs You entries cannot show whether each needs a review decision or
  recovery step without opening it.
- **Sam, keyboard/screen-reader user:** The accessible row name includes a unique title, but repeated “Open” provides no
  next-action cue; links remain keyboard reachable. No claim about actual screen-reader speech is made.
- **Casey, phone user:** A short glance shows only Needs You and Ready to Continue; urgent work is not more visually
  prominent than the rest. Long Plan names do wrap, which helps.

## Cognitive load and journey

Six of eight checks pass: grouping, four categories, title-first rows, five-item disclosure, one obvious link per row,
and compact metadata. The two weak checks are visual hierarchy (equal sections) and recognition (generic actions plus
absent time context). Four visible section choices are manageable. The page starts reassuringly, but opening several
Plans just to learn the next step slows triage. An incomplete Project check can replace reassurance with doubt,
especially beside a zero count.

## Minor observations

- The development fixture is static; it does not represent sort, expansion, loading or warning states of the live
  component.
- Browser console recorded a development Astro island `WorkspaceMenu.tsx` dynamic-import hydration error; production
  impact was not established.

## Questions to consider

- Should Needs You show the exact pending decision and evidence source before a click?
- What does “recent” mean, and when does a finished Plan leave the dashboard?
- Should an incomplete dashboard ever show an unqualified zero?
