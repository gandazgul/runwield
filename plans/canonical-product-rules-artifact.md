---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Make docs/product-rules.md an optional canonical Product Rules artifact that Ideator curates lazily and Planner, execution agents, Reviewer, and Guide honor when present."
affectedPaths:
    - "CONTEXT.md"
    - "docs/product-rules.md"
    - "docs/index.md"
    - "docs/prd/runwield-core-prd.md"
    - "src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/workflow-prompts/slicer-prompt.md"
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/agent-definitions/workflow-prompts/reviewer-prompt.md"
    - "src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md"
    - "src/agent-definitions/workflow-prompts/reviewer-feedback-engineer.md"
    - "src/agent-definitions/guide.md"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/workflow/validation-prompts.test.js"
    - "src/shared/workflow/workflow-prompts.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T01:10:59-04:00"
updatedAt: "2026-08-01T05:17:42.853Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
planId: "fc57f6a6-a704-4f7e-88ca-29f0e5d1af9b"
---

I havent read therough this and want to think about it more, but I think this is a good start. I want to make sure we
have a clear definition of what a Product Rule is and how it differs from other artifacts like PRDs, ADRs, and
CONTEXT.md. I also want to make sure we have a clear process for how Ideator curates these rules and how Planner and
other agents honor them.

# Canonical Product Rules Artifact

## Context

RunWield already has `docs/product-rules.md` in this repository. It contains owner-stated rules such as PR-1 through
PR-7 that constrain RunWield behavior, and its introduction already says reviewers should cite rule numbers. Today,
however, Agent Definitions mostly treat it as ordinary documentation: Guide's evidence table does not name it as a
canonical source, Planner has no Product Rules discipline parallel to `CONTEXT.md`, Engineer and Frontend Engineer do
not check it, and Reviewer is scoped to Plan requirements plus concrete defects without explicit Product Rule authority.

The product decision for this change is that every RunWield-managed repository may optionally define
`docs/product-rules.md` as canonical repo-local project memory. It is not initialized automatically and it does not
contain candidate rules. If the file is absent, agents must assume there are no hard Product Rules. If present, it
records owner-confirmed standing product constraints that future Ideation, Planning, execution, review, and Guide
answers must respect and cite.

## Objective

Make Product Rules a first-class optional canonical artifact across RunWield agent behavior and documentation:

- Ideator lazily creates or updates `docs/product-rules.md` only when the user states or confirms a stable standing
  Product Rule.
- Planner, Architect, and Slicer read Product Rules when present and ensure Plans/Epics/child Plans respect them,
  including rule-specific verification checks when feasible.
- Engineer, Frontend Engineer, and Reviewer-Feedback Engineer read Product Rules when present and treat them as hard
  constraints alongside the assigned Plan or findings.
- Reviewer reads Product Rules when present and may reject a change that violates a relevant rule, citing the PR-* rule
  number and the changed hunk.
- Guide treats Product Rules as authoritative product-constraint evidence and cites them when answering product or code
  questions.
- `wld init` continues not to create, infer, or seed Product Rules or candidate Product Rules.

## Approach

Implement this as prompt/documentation work, not as a new runtime preloading pipeline. Product Rules should preserve
RunWield's context-parsimony philosophy: agents explicitly check `docs/product-rules.md` when their role needs it, and
absence is a valid state meaning no hard Product Rules exist.

Add a bundled document-format guide for Product Rules so Ideator has a disciplined target shape. Update RunWield's own
`docs/product-rules.md` introduction to explain the general artifact semantics and admission criteria while keeping the
existing RunWield-specific PR-1 through PR-7 rules. Update canonical product docs and glossary language so users and
agents understand that Product Rules are separate from `CONTEXT.md`, PRDs, ADRs, Plans, Work Records, tests, and style
preferences.

Teach all relevant Agent Definitions/prompts to use the artifact without creating noise:

- Ideator is the preferred curator and does not create the file proactively.
- Plan-producing agents consult rules and convert relevant rules into Plan constraints and verification.
- Execution agents stop/report if an assigned Plan or repair would require violating a Product Rule.
- Reviewer treats Product Rule violations as blocking only when it can cite both a specific rule and changed code.
- Guide uses Product Rules as citable authority but does not edit them.

## Files to Modify

- `CONTEXT.md` — add canonical language for Product Rule / Product Rules as optional repo-local standing product
  constraints.
- `docs/product-rules.md` — update RunWield's own Product Rules file introduction with artifact semantics, entry
  criteria, and non-goals; preserve existing PR-1 through PR-7 content.
- `docs/index.md` — update the Product Rules documentation entry to describe the artifact as optional canonical project
  memory, not only RunWield-local docs.
- `docs/prd/runwield-core-prd.md` — add Product Rules to Core's durable artifact/product-memory model and describe agent
  behavior at the product level.
- `src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md` — add the canonical Product Rules format and
  admission criteria used by Ideator.
- `src/agent-definitions/ideator.md` — teach Ideator to lazily create/update Product Rules only for owner-confirmed
  standing constraints; no candidates, no init-style inference.
- `src/agent-definitions/planner.md` — add Product Rules discipline before drafting/revising Plans, including
  rule-specific Plan constraints and verification checks when feasible.
- `src/agent-definitions/architect.md` — make PROJECT/Epic design respect Product Rules so large work cannot bypass the
  artifact.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — make child Plan materialization carry relevant Product
  Rules into child Plan constraints and verification.
- `src/agent-definitions/engineer.md` — require reading Product Rules when present and stopping/reporting contradictions
  with the Plan or quick-fix request.
- `src/agent-definitions/frontend-engineer.md` — mirror Engineer Product Rules behavior for browser UI execution.
- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` — allow discovery review to block on concrete Product Rule
  violations with PR-* citations.
- `src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md` — require verification rounds to preserve Product
  Rule findings and reject Product Rule violations introduced by repairs.
- `src/agent-definitions/workflow-prompts/reviewer-feedback-engineer.md` — make repair agents treat Product Rules as
  standing constraints when resolving findings.
- `src/agent-definitions/guide.md` — add Product Rules to artifact locations, authority hierarchy, citation guidance,
  and the no-edit list.
- `src/shared/session/__tests__/session-tools-policy.test.js` — add regression assertions that Guide loaded instructions
  recognize Product Rules authority and no-edit boundaries.
- `src/shared/workflow/validation-prompts.test.js` — add regression assertions for Reviewer, Reviewer verification, and
  Reviewer-feedback Engineer Product Rule behavior.
- `src/shared/workflow/workflow-prompts.test.js` — add prompt-level regression assertions for Engineer/Slicer handoffs
  only if the implementation changes prompt builders; otherwise leave this file unchanged.

## Reuse Opportunities

- `src/agent-definitions/planner.md` Domain Language Discipline — use the same pattern for a Product Rules Discipline
  section, with different semantics.
- `src/agent-definitions/ideator.md` Domain Language Discipline and ADR guidance — reuse the same curatorial style for
  deciding whether a statement belongs in Product Rules, PRD, ADR, Plan, `CONTEXT.md`, tests, or nowhere canonical.
- `src/agent-definitions/guide.md` Durable Evidence table and Authority Hierarchy — add Product Rules as a first-class
  row/source rather than inventing a new evidence mechanism.
- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` blocking/advisory distinction — extend the existing
  "specific requirement plus changed code" standard to "specific Product Rule plus changed code".
- `src/shared/session/__tests__/session-tools-policy.test.js` and `src/shared/workflow/validation-prompts.test.js` —
  existing prompt regression tests already assert durable-evidence and reviewer contract wording.
- `src/agent-definitions/document-formats/ADR-FORMAT.md` and `CONTEXT-FORMAT.md` — use their concise canonical-format
  style as a model for the new Product Rules format file.

## Implementation Steps

- [ ] `CONTEXT.md` defines `Product Rule` as an owner-confirmed, stable, cross-cutting, normative product constraint and
      defines `docs/product-rules.md` as the optional canonical repo-local Product Rules artifact. The definition says
      absence means no hard Product Rules and distinguishes Product Rules from glossary terms, PRDs, ADRs, Plans, Work
      Records, tests, and preferences.
- [ ] `src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md` exists and specifies the canonical artifact
      shape: title, short purpose, admission criteria, optional short non-goals section, and numbered rules such as
      `PR-1 — <name>` with consequences when useful. The format forbids candidate/inferred rules and states that
      tentative product direction belongs in PRDs.
- [ ] `docs/product-rules.md` preserves all existing RunWield PR-1 through PR-7 rule text and adds a concise generic
      introduction explaining that this file is RunWield's own instance of the optional canonical Product Rules
      artifact.
- [ ] `docs/index.md` and `docs/prd/runwield-core-prd.md` describe Product Rules as optional canonical project memory
      loaded when present, created lazily by Ideator, and not created or inferred by init.
- [ ] `src/agent-definitions/ideator.md` includes a Product Rules Discipline section: it checks for existing
      `docs/product-rules.md` when users propose standing constraints, uses the new format file when creating/updating
      the artifact, admits only owner-confirmed stable cross-cutting normative violation-prone rules, and keeps
      candidates/noise in PRDs or the conversation instead of `docs/product-rules.md`.
- [ ] `src/agent-definitions/planner.md` includes a Product Rules Discipline section requiring Planner to read
      `docs/product-rules.md` when present before drafting/revising a Plan, cite relevant PR-* rules in the Plan
      context/approach/edge cases as appropriate, and add automated or manual verification checks against relevant rules
      when feasible.
- [ ] `src/agent-definitions/architect.md` and `src/agent-definitions/workflow-prompts/slicer-prompt.md` include
      equivalent Product Rules discipline so PROJECT Epics and child Plans cannot bypass rules that Planner would have
      enforced on a standalone Planned Change.
- [ ] `src/agent-definitions/engineer.md`, `src/agent-definitions/frontend-engineer.md`, and
      `src/agent-definitions/workflow-prompts/reviewer-feedback-engineer.md` require execution/repair agents to read
      Product Rules when present, treat them as hard constraints alongside the Plan/findings/request, and stop or report
      a blocker when the assigned work would require violating a Product Rule.
- [ ] `src/agent-definitions/workflow-prompts/reviewer-prompt.md` says discovery review must check
      `docs/product-rules.md` when present and may block only when it can cite both a specific Product Rule number/title
      and specific changed code/hunk that violates it; absent Product Rules means no Product Rule basis for rejection.
- [ ] `src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md` says verification review preserves open Product
      Rule findings, resolves them only by inspecting code, and treats Product Rule violations introduced by a repair as
      new blocking findings.
- [ ] `src/agent-definitions/guide.md` lists Product Rules in artifact locations and authority hierarchy, instructs
      Guide to cite `docs/product-rules.md#PR-*` or equivalent headings for product-constraint answers, says absence
      means no hard Product Rules artifact exists, and forbids Guide from editing Product Rules through documentation
      tools.
- [ ] `src/agent-definitions/workflow-prompts/init-agent-prompt.md` remains free of any instruction to create, infer,
      seed, or candidate-list Product Rules during init.
- [ ] Prompt regression tests assert the new Product Rules contract for Guide, Reviewer discovery, Reviewer
      verification, Reviewer-feedback Engineer, Planner, Ideator, Engineer, Frontend Engineer, Architect, and Slicer
      using existing prompt-loading or direct file-read patterns.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/workflow/validation-prompts.test.js src/shared/workflow/workflow-prompts.test.js`
- Automated: `deno task test`
- Objective-failing check: after implementation, this command must exit 0 and it fails against the current repository
  because the named prompts do not all describe `docs/product-rules.md` as an optional canonical artifact:

  ```bash
  deno eval '
  const required = [
    "src/agent-definitions/ideator.md",
    "src/agent-definitions/planner.md",
    "src/agent-definitions/architect.md",
    "src/agent-definitions/workflow-prompts/slicer-prompt.md",
    "src/agent-definitions/engineer.md",
    "src/agent-definitions/frontend-engineer.md",
    "src/agent-definitions/workflow-prompts/reviewer-prompt.md",
    "src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md",
    "src/agent-definitions/workflow-prompts/reviewer-feedback-engineer.md",
    "src/agent-definitions/guide.md",
  ];
  for (const path of required) {
    const text = await Deno.readTextFile(path);
    if (!text.includes("docs/product-rules.md")) throw new Error(`${path} does not mention docs/product-rules.md`);
    if (!text.includes("Product Rules")) throw new Error(`${path} does not mention Product Rules`);
  }
  '
  ```

- Objective-failing check: after implementation, this command must exit 0 and it fails against the current repository
  because the Product Rules format file does not exist:

  ```bash
  test -f src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md && \
    grep -q "owner-confirmed" src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md && \
    grep -q "No candidate" src/agent-definitions/document-formats/PRODUCT-RULES-FORMAT.md
  ```

- Product-rule absence check:
  `grep -n "product-rules\|Product Rules" src/agent-definitions/workflow-prompts/init-agent-prompt.md` must return no
  matches, proving init was not taught to create or infer rules.
- Glossary/docs check:
  `grep -n "Product Rule" CONTEXT.md docs/product-rules.md docs/prd/runwield-core-prd.md docs/index.md` shows aligned
  language that Product Rules are optional canonical standing constraints and absence means no hard rules.
- Reviewer contract check:
  `grep -n "specific Product Rule" src/agent-definitions/workflow-prompts/reviewer-prompt.md src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md`
  shows Reviewer can block only with a specific rule citation and code evidence, preserving the existing
  default-approval guardrail.
- Existing behavior still protected: Reviewer must still approve by default when only verification evidence is missing,
  Guide must remain read-only for canonical workflow artifacts, and init must continue producing only `CONTEXT.md` plus
  project memories.
- Behavior expected to stop existing: Product Rules must no longer be treated only as ordinary low-authority
  documentation in Guide answers or invisible to planning/execution/review prompts.

## Edge Cases & Considerations

- Avoid Product Rules becoming a preference dump: all prompts and the format file must include strict admission language
  rather than telling agents to capture every product preference.
- Avoid inferred product law: init must not create candidates or promote facts learned from code/docs into Product
  Rules.
- Absence is normal: agents must not fail or create the file when `docs/product-rules.md` is missing; they should simply
  proceed with no hard Product Rules.
- Product Rules do not prove implementation: Guide and Reviewer must distinguish rules as constraints from
  source/tests/Work Records as implementation or outcome evidence.
- PROJECT coverage matters: Architect and Slicer need Product Rules instructions even though the user emphasized
  Planner, because otherwise Epic decomposition could bypass constraints that standalone Planned Change planning would
  honor.
- No runtime preloading is planned: this change is prompt/docs/test-only unless implementation discovers an existing
  prompt assembly path that already centrally handles canonical artifact guidance. Do not add a broad context injection
  mechanism for Product Rules in this Plan.
