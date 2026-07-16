# Product Requirements Document: Spec Kit Importer

Last updated: 2026-07-16 16:16 EDT

Working draft. This PRD describes a future interoperability capability for importing GitHub Spec Kit artifacts into
RunWield without adopting Spec Kit's artifact model as RunWield's canonical workflow.

## Objective

Add a **Spec Kit Importer** that can read an existing `.specify/` / `specs/<feature>/` feature directory and turn its
useful intent, planning, and task context into RunWield-native artifacts or session context.

The importer should make RunWield complementary to Spec Kit for teams that already used Spec Kit to define work, while
preserving RunWield's Plan-by-Default lifecycle, validation, worktree isolation, and Work Record model.

## Problem Statement

Spec Kit creates structured artifacts such as:

- `spec.md` for user scenarios, requirements, edge cases, and success criteria
- `plan.md` for technical context and implementation strategy
- `tasks.md` for implementation tasks grouped by user story
- optional research, data model, contract, checklist, and quickstart documents

RunWield already has its own durable artifacts and lifecycle:

- Plans under `plans/`
- PRDs, ADRs, and `CONTEXT.md`
- Plan Front Matter and Plan Lifecycle events
- execution worktrees and Workflow Validation
- future Work Records under `docs/work-records/`

Without an importer, a user who has Spec Kit artifacts must manually paste or summarize them into RunWield. That loses
traceability and increases the chance that RunWield plans from an incomplete picture.

## Target Users

- Users experimenting with both Spec Kit and RunWield.
- Teams migrating from Spec Kit-driven planning to RunWield execution.
- Users who receive a Spec Kit feature directory from another project or teammate.
- RunWield Agents that need to treat external spec artifacts as first-class context.

## Product Principles

- **Interoperate, do not assimilate.** RunWield should import from Spec Kit, not become Spec Kit.
- **Preserve provenance.** Imported RunWield artifacts should link back to source Spec Kit files.
- **Keep Plans canonical for execution.** A Spec Kit `tasks.md` should not become a parallel executable authority.
- **Let the user choose import intent.** The same source can become a PRD, a Plan, planning context, or a Work Record.
- **Avoid silent loss.** If source sections are unsupported or contradictory, surface that explicitly.

## Proposed Experience

A user points RunWield at a Spec Kit feature directory or repository containing `.specify/` artifacts.

RunWield inspects available files and offers import modes:

1. **Create PRD:** turn `spec.md` into a RunWield PRD under `docs/prd/` for ideation/planning.
2. **Create Plan:** synthesize a RunWield Plan under `plans/` from `spec.md`, `plan.md`, and optionally `tasks.md`.
3. **Use as context:** attach the Spec Kit artifacts to the current planning session without writing a new artifact yet.
4. **Create Work Record:** for completed external work, create a draft external Work Record with provenance.

The importer should show a source coverage summary before writing:

- source files found
- sections understood
- sections ignored or folded into notes
- contradictions or unresolved clarifications
- proposed RunWield artifact path

## Functional Requirements

- RunWield should detect a Spec Kit feature directory and identify common files such as `spec.md`, `plan.md`,
  `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`.
- RunWield should preserve source paths in the generated artifact or session context.
- The importer should map Spec Kit user scenarios, functional requirements, success criteria, assumptions, and edge
  cases into RunWield-native planning language.
- The importer should treat Spec Kit technical plans and tasks as context, not as automatically approved RunWield Plans.
- The importer should flag unresolved `[NEEDS CLARIFICATION]` markers before creating an executable Plan.
- The importer should support a dry-run summary before writing files.
- Imported executable work should still pass through RunWield Plan review and readiness before Engineer starts.

## Technical Approach

This should start as a read-and-synthesize workflow rather than a fully general migration engine.

Likely components:

- source discovery for `.specify/` and `specs/<feature>/` directories
- Markdown section extraction for known Spec Kit templates
- provenance model for linking generated RunWield artifacts to source files
- synthesis prompts for PRD, Plan, context-only, and Work Record import modes
- validation checks for unresolved clarification markers and missing execution-critical sections
- optional Workspace UI for previewing source coverage and import mode

## Out of Scope

- Running Spec Kit commands from RunWield.
- Installing or managing Spec Kit.
- Treating Spec Kit `tasks.md` as a RunWield Plan Lifecycle artifact.
- Guaranteeing lossless conversion of every custom Spec Kit preset, extension, or bundle.
- Automatically executing imported work without RunWield review.

## Success Criteria

- Users can bring a Spec Kit-defined feature into RunWield without manual copy/paste.
- Generated RunWield artifacts clearly cite their Spec Kit source files.
- Imported Plans still obey RunWield Plan Lifecycle and Workflow Validation rules.
- Unresolved clarifications and source contradictions are visible before execution.
- The importer makes RunWield more attractive to Spec Kit users without blurring product positioning.

## Open Questions

- Should import be exposed as a CLI command, a Workspace action, an Ideator/Planner capability, or all three?
- Should RunWield store source artifact hashes to detect drift after import?
- How should the importer handle Spec Kit presets that radically change template structure?
- Should imported `tasks.md` content influence Plan slicing, or remain purely explanatory context?
