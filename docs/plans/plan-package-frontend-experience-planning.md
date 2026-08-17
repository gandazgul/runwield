---
planId: "b4ac88bf-b0d5-42d3-b755-ab0623fd3fe1"
classification: "PROJECT"
complexity: "HIGH"
summary: "Build stronger frontend planning and acceptance on Plan Packages through Epic-level user journeys that children reference by ID, representative states, reviewed prototypes, independent browser validation, and a ban on UI that explains its own build state."
affectedPaths:
    - "docs/plans/"
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "src/agent-definitions/"
    - "src/skills/"
    - "src/tools/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/design-system.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Plan Package Frontend Experience Planning

## Context

The `plan-packages-and-independent-validation` PROJECT establishes versioned Plan Packages and separates Engineer,
Validator, Semantic Reviewer, and repair authority. This dependent PROJECT uses those boundaries to improve materially
visual and interactive frontend work without coupling product-experience design to the foundational storage and
lifecycle migration.

The Personal Remote Workspace Session list exposed the product failure this PROJECT must prevent: canonical TUI Session
names and timestamps existed, but Workspace projected untitled UUID cards with internal preparation language and no
useful recency. The implementation could prove creation, continuation, takeover, and rendering mechanisms while still
failing the owner's basic job of finding the correct Session. Empty-state browser evidence did not exercise the
populated experience the feature was meant to deliver.

Frontend planning therefore needs an explicit experience contract. Implementation steps and generic browser checks are
not enough when the missing requirement is the user's journey, the information needed at a decision point, or the
behavior of representative populated states.

A second failure comes from where that contract lives. When each slice of an Epic owns its own experience description,
the slice boundary becomes visible to the end user. The implementation Agent reaches a capability a later slice will
add, and ships the gap as product copy: a banner, a disabled control captioned with a reason, a tooltip naming a slice
number. The Plans teach this. `docs/plans/personal-remote-workspace-v1/` contains sentences such as "workflow remains
read-only until slice 16 supplies its Plan actions" and "until slice 10 adds the cross-Project Attention Dashboard".
Each sentence is a correct scope boundary written for the implementer, and the implementer forwards it to the user
because nothing tells it not to. No current Agent definition prohibits it.

The foundation PROJECT makes the Epic the release unit, so the audience for that copy does not exist. This PROJECT puts
the experience contract at the same level as the release and states the prohibition directly.

This PROJECT must begin only after `plan-packages-and-independent-validation` lands and its package, validation,
completion-signal, and Plan-defect authorities have been re-audited.

## Objective

Extend Plan Packages for material browser experiences so product intent is designed, reviewed, implemented, and
validated independently:

- `user-journeys.md` belongs to the release unit, not to the slice: one journey document on the Epic package for Epics
  with material UI work, or on the Plan package itself for a standalone material UI FEATURE;
- journeys carry stable identifiers, and each child declares in its own `validation.md` which identifiers it completes
  and which it contributes to, so a child that half-builds a journey is normal rather than a coverage gap;
- Planner loads a UI/UX planning skill, inspects the current product, defines concrete actors/jobs, journeys,
  representative states, and information requirements, and maps those outcomes into the package validation contract;
- Planner records whether a throwaway prototype is needed, favors one when it materially reduces experience uncertainty,
  reviews it in a browser, and obtains owner feedback before package approval;
- an accepted prototype is stored as a stable, revisioned behavioral and visual reference, not production code;
- Frontend Engineer implements the approved experience and may use targeted checks while developing, but does not claim
  independent journey validation;
- the product never explains its own build state: no slice or Plan identifiers in the interface, no "coming soon", no
  "not yet implemented", and no control that exists only to say why it does nothing. Work that is out of scope has no
  affordance at all. Empty states, permission messages, error states, and loading states stay, because they describe
  product state the user caused or can act on;
- Validator loads a user-journey validation skill, executes all automatable browser and agent-observable journeys across
  representative states, and records evidence for every journey ID; child validation covers the identifiers that child
  declared, and the Epic's integrated validation covers every journey end to end across the assembled branch;
- generated `manual-qa.md` contains only the remaining judgments that genuinely require the owner; and
- validation, review, repair, Plan-defect, and publication behavior continues through the authorities established by the
  foundation PROJECT.

The option set aside is embedding more UX reminders and browser instructions in `plan.md`. That would keep experience
intent mixed into implementation prose, make journey coverage hard to review atomically, and allow incidental browser
screenshots to masquerade as product acceptance.

## Vertical Slice Findings

The current frontend path is implementation-shaped:

```text
Plan implementation and verification prose
  -> Frontend Engineer
  -> optional Pair checkpoints
  -> browser inspection selected by the implementer
  -> general Workflow Validation
```

The target path is experience-shaped:

```text
current-product inspection
  -> user journeys + representative states, on the release unit
  -> optional throwaway prototype
  -> owner review of the intended experience
  -> atomic package approval
  -> Frontend Engineer implementation
  -> independent Validator journey execution
  -> Semantic Reviewer
  -> genuinely human-only owner acceptance when required
```

For an Epic, the journey document sits beside the Epic's own validation contract, and children point at it:

```text
docs/plans/<epic>/user-journeys.md      J-01 … J-0n, stable identifiers
docs/plans/<epic>/validation.md         integrated: every journey, assembled branch
docs/plans/<epic>/<child>/validation.md completes J-02, contributes to J-04
```

Positive present tense is what removes the leak. A journey states what the user does and how success is observed, so it
has no grammatical slot for a deferral:

```text
today, in a slice plan.md:
  "Plan views remain read-only until slice 16 supplies actions."
       a sentence about the product, phrased as absence — easy to forward into the UI

as a journey on the Epic:
  J-04  Owner opens a Plan and reads status, steps, and evidence.
        Success: the owner can tell whether the Plan is ready to run.
       nothing to forward; there is no "until" to copy
```

Deferral language does not disappear. It moves to engineer-facing sections of the child `plan.md`, where scope
boundaries belong, and out of any text that describes the product to its user.

The Plan Package foundation supplies the atomic revision, Epic branch, Epic validation, and role boundaries. This
PROJECT supplies the frontend artifacts, planning behavior, browser evidence, and owner experience needed to use those
boundaries well.

## Files to Modify

- `src/agent-definitions/` — teach Planner and Frontend Engineer the experience-contract boundary without giving either
  independent validation authority; add the build-state prohibition to `frontend-engineer.md`; and keep deferral
  language inside engineer-facing sections of the Planner and Slicer plan formats under
  `src/agent-definitions/document-formats/`.
- `src/skills/` — add UI/UX planning and Validator journey-validation skills; reuse the existing prototype workflow.
- `src/shared/workflow/` — require and project journey contracts for material UI packages, preserve prototype decisions,
  run independent journey validation, and route findings through the foundation repair and defect paths.
- `src/shared/session/` — preserve prototype feedback and journey-validation continuation across stable Session
  segments.
- `src/tools/` — add typed prototype-review and journey-evidence boundaries where the foundation tools are insufficient.
- `src/ui/tui/` and `src/ui/workspace/` — review journey artifacts and prototype/candidate previews, and collect owner
  feedback or genuinely human-only acceptance decisions.
- `docs/domain-language.md`, `docs/prd/runwield-core-prd.md`, and `docs/design-system.md` — define experience contracts,
  representative states, prototype authority, and their user-facing presentation.

## Reuse Opportunities

- Plan Package aggregate approval and revision boundaries from `plan-packages-and-independent-validation`.
- Existing prototype skill and `prototypes/` isolation rules for throwaway design exploration.
- Existing Pair Execution interaction broker for prototype feedback and implementation checkpoints.
- Existing browser control and browser acceptance infrastructure for representative journey execution.
- Existing Validator, Semantic Reviewer, repair, Plan-defect proposal, owner decision, and publication authorities from
  the foundation PROJECT.
- Current Workspace design system and browser surfaces as the baseline for new review experiences.

## Verification Plan

- Planning children must prove a material UI package cannot become ready for work without concrete journeys,
  representative states, information requirements, a prototype decision, and owner-reviewed prototype evidence when a
  prototype was chosen.
- Package children must prove `user-journeys.md` participates in the approved package revision while generated evidence
  and mutable owner QA do not; that an Epic with material UI work owns exactly one journey document; and that a child
  cannot become ready for work while it claims a journey identifier the Epic does not define.
- Validator children must prove every journey ID maps to representative automated, browser, agent-executable, or
  genuinely human-only evidence and that empty-state evidence cannot satisfy a populated-state journey.
- Journey coverage children must prove child validation covers only the identifiers that child declared, that Epic
  integrated validation covers every defined journey, and that a journey no child claimed is reported as never built
  rather than as a passing outcome.
- Build-state children must prove Frontend Engineer does not add interface text or controls that describe build
  progress, and that empty states, permission messages, error states, and loading states remain allowed. The check reads
  rendered interface text, not source comments or Plan prose.
- Prototype children must prove accepted references are stable and revisioned, remain separate from production code, and
  become stale when the approved experience changes.
- Repair children must prove a journey failure returns through bounded implementation repair and then complete Validator
  and Semantic Reviewer passes.
- Integration children must exercise Router through Planner, current-product inspection, optional prototype review,
  package approval, Pair or autonomous Frontend Engineer execution, independent journey validation, semantic review,
  optional owner acceptance, and publication.
- Automated suites must run through `scripts/run-tests.js`, `deno task seams:check`, and `deno task ci`; browser
  children must also run the project's approved browser acceptance framework and headed journeys.

### Outcome Evidence

- **Material UI Plans define an experience before implementation** — every approved material UI package contains real
  actor/jobs, stable journey IDs, representative states, information requirements, and observable success outcomes.
- **Journeys belong to the release unit** — an Epic with material UI work carries one journey document with stable
  identifiers; children reference those identifiers and never define competing ones; a standalone material UI FEATURE
  carries its own.
- **Partial journeys are expected, not hidden** — a child may complete some identifiers and contribute to others, and
  the difference between "no child claimed this" and "a child claimed this and it does not work" is visible in the
  Epic's integrated result.
- **The product never explains its own build state** — no shipped interface names a slice or Plan, promises a later
  capability, or renders a control whose only purpose is to say it does nothing. Out of scope means the affordance is
  absent. Empty, permission, error, and loading states are unaffected.
- **Prototype decisions are explicit** — each material UI package records why a prototype is or is not needed; when one
  is chosen, package approval includes an owner-reviewed reference with stable revision evidence.
- **Frontend implementation follows an accepted direction** — Frontend Engineer receives the approved experience
  contract and prototype reference without receiving authority to approve its own journey evidence.
- **Journey validation is independent and complete** — Validator records a disposition and evidence for every journey ID
  across its required representative states before semantic review can begin.
- **Populated experiences cannot hide behind empty states** — fixtures and browser journeys exercise the information and
  actions users need in realistic populated conditions.
- **Human QA is genuinely human** — anything browser automation or an agent can observe is executed by Validator;
  `manual-qa.md` contains only remaining owner judgment.
- **Experience omissions use the established Plan-defect path** — Agents may propose that the approved journey contract
  is defective, but only the user can reopen planning under the foundation lifecycle.
- **Existing behavior remains protected** — Pair and autonomous execution, Workspace and TUI review surfaces, package
  collaboration, independent validation, Semantic Review, repairs, recovery, and publication continue to work.
- **Behavior expected to stop existing** — generic implementation prose is not accepted as a journey contract;
  self-selected screenshots do not prove representative experience outcomes; prototype code is not promoted into
  production; generated Manual QA is not used as a substitute for independent validation; each slice does not carry its
  own experience contract; and slice boundaries are not visible in the shipped interface.

## Edge Cases & Considerations

- “Material UI” needs one product-level definition based on user-visible interaction and information architecture, not a
  fragile list of file extensions or frameworks.
- Journeys should describe real roles, contexts, knowledge, constraints, jobs, and observable outcomes rather than
  fictional demographic personas.
- A representative state is not necessarily a production data snapshot. Deterministic fixtures should preserve privacy
  while exposing the information density and edge conditions that shape the experience.
- Prototypes are approved behavioral and visual references, not production code. Stable paths and digests must expose
  staleness without encouraging Frontend Engineer to copy throwaway implementation.
- Owner feedback during prototype review changes the package specification; owner acceptance after implementation judges
  only the genuinely human outcomes that Validator cannot execute.
- Direct package edits remain supported, but changing `user-journeys.md` must invalidate approval consistently with
  changes to `plan.md` or `validation.md`. Because the Epic journey document is shared, editing it after children are
  approved has to invalidate the children that reference the changed identifiers, not silently move their target.
- Journey identifiers must stay stable for the life of the Epic. Renumbering after children reference them breaks
  claimed coverage and makes integrated results unreadable.
- The build-state prohibition needs a check that survives paraphrase. An implementer that cannot write "slice 6" can
  still write "available in a future update". The rule is about naming build progress at all, not about a word list, and
  the child that implements it should say how the check draws that line.
- A slice can leave a surface looking sparse. Under an Epic branch nobody ships that surface, so sparse is acceptable
  and the prohibition costs nothing. If the user overrides an Epic to publish per child, the trade-off returns and the
  answer is to redraw the boundary, not to label the gap.
- Progress belongs in RunWield's own surfaces. The owner running the app off an Epic branch mid-flight has the Plan
  Board, the TUI, and the Epic's records; that need must not push build-state text back into the product.
