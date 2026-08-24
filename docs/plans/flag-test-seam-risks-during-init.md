---
planId: "e16197ef-5655-4ea4-a410-bf23427a85c6"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Teach the universal fake-external-systems rule during initialization and have the Init Agent report evidence-backed possible dependency-seam risks for the user to classify, without adding a cross-language checker or exporting RunWield internals."
affectedPaths:
    - "docs/plans/flag-test-seam-risks-during-init.md"
    - "docs/domain-language.md"
    - "docs/user-facing-features.md"
    - "src/agent-definitions/subagent-definitions/init-agent-prompt.md"
    - "src/shared/session/subagent-definitions.test.ts"
    - "src/skills/write-tests/"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'Possible test-seam risks' src/agent-definitions/subagent-definitions/init-agent-prompt.md && deno run -A scripts/run-tests.js src/shared/session/subagent-definitions.test.ts"
      rationale: "The Init Agent must explicitly report uncertain seam findings instead of silently classifying or fixing them, and the subagent contract tests must pass with that text present."
    - id: "OC2"
      command: "grep -q 'write-tests' src/agent-definitions/subagent-definitions/init-agent-prompt.md && grep -q 'product-owned machinery' src/agent-definitions/subagent-definitions/init-agent-prompt.md"
      rationale: "Initialization must name the shared testing practice and state the ownership rule in language-neutral terms."
    - id: "OC3"
      command: "grep -q 'Deno.test(\"Init prompt teaches seam-risk guidance without leaking RunWield internals\"' src/shared/session/subagent-definitions.test.ts && deno eval 'import {SUBAGENTS as S} from \"./src/constants.js\";import {loadSubAgentDefinition as l} from \"./src/shared/session/subagent-definitions.ts\";const p=(await l(S.INIT)).systemPrompt;for(const s of [\"write-tests\",\"product-owned machinery\",\"Possible test-seam risks\",\"exact file\",\"fixture\",\"confidence\",\"uncertain\",\"bounded\",\"no candidates\",\"dismiss\",\"unpersisted\"])if(!p.includes(s))Deno.exit(1);for(const s of [\"check-injection-seams\",\"seams:check\",\"injection-seam-baseline\",\"ValidationSessionPort\",\"ExecutionStartPorts\",\"src/\",\"scripts/\"])if(p.includes(s))Deno.exit(1)' && deno run -A scripts/run-tests.js src/shared/session/subagent-definitions.test.ts --filter '^Init prompt teaches seam-risk guidance without leaking RunWield internals$'"
      rationale: "The check loads the composed Init prompt itself and verifies its required guidance and forbidden identifiers, then requires and runs the named contract test. Prompt metadata, inert strings, an empty forbidden list, or a test that never loads the composed prompt cannot satisfy it."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T23:55:00-0400"
updatedAt: "2026-08-24T05:02:00.593Z"
status: "validated"
origin: "user"
implementedAt: "2026-08-23T17:20:49.363Z"
validatedAt: "2026-08-24T05:02:00.593Z"
userVerifiedAt: null
executionReport: "- Implemented Init prompt guidance: it now loads `write-tests`, states the product-owned machinery rule, keeps discovery bounded, reports `Possible test-seam risks`, asks for user disposition, and avoids RunWield-private checker/layout names.\n- Added contract coverage in `src/shared/session/subagent-definitions.test.ts`: 2 tests added, 0 tests removed or replaced; coverage now loads the composed Init prompt, checks required advisory guidance, checks internal identifiers stay absent, and covers internal fake, external boundary, and ambiguous-case guidance.\n- Updated docs: `docs/user-facing-features.md` now describes bounded advisory init discovery; `docs/domain-language.md` defines `Possible test-seam risks` as a user-classified advisory section.\n- Repaired a lint failure in `src/ui/workspace/react/PlanReviewSurface.tsx` by returning resolved Promises instead of `async` callbacks with no `await`.\n- Mutation proof passed: adding a private checker mention and adding automatic Plan creation each made the focused contract test fail, then the original prompt was restored and the focused test passed.\n- Verification passed: OC1, OC2, OC3; focused Init prompt tests; `src/cmd/init/index.test.ts`; `deno task check`; `deno task lint`; `deno task doc-links:check`; `deno fmt --check` on changed files.\n- Verification did not pass cleanly: `deno task ci` failed in `src/ui/tui/golden-scenarios/validation-workflow-publication.test.ts` on `validation-tree-publication-push-failure-retry`, consistently timing out after a publication recovery prompt mismatch (`expected \"could not be updated upstream\", got \"Plan recovery (validated):\"`). This is unresolved."
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-24T03:51:23.304Z"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "46c8c6142c958398cb82f67acec06b09ddbbad17"
    targetBranch: "main"
    targetHeadBeforeMerge: "572946d552825570f0589ae817cecd5e5c63e3e7"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Flag possible test-seam risks during initialization

## Context

RunWield learned a general testing practice while removing its own dependency bags:

- fake systems outside the product boundary, such as networks, subprocesses, clocks, browsers, model calls, and hosted
  services;
- exercise product-owned behavior through real machinery over isolated fixture projects, repositories, stores, and
  homes;
- be suspicious of optional bags of behavior, production fallbacks between injected and system implementations, mutable
  test overrides, and test-only production branches.

This practice applies across languages. Reliable automatic enforcement does not. RunWield is used in repositories with
different languages, architecture conventions, source layouts, test frameworks, and dependency-injection idioms. A
generic checker would either miss important cases or impose RunWield's JavaScript-specific assumptions on customers.

Initialization already explores each repository deeply enough to notice suspicious examples. It surfaces those examples
as possible issues for the user to classify.

## Objective

Extend the Init Agent so it:

- reads the bundled `write-tests` skill and applies its ownership rule in the repository's own language and terms;
- looks for concrete signs that tests can replace product-owned behavior;
- distinguishes confirmed syntax from an ownership judgment that still belongs to the user;
- reports evidence-backed possible issues with file locations and a short explanation;
- asks the user what, if anything, should be persisted or planned;
- keeps discovery read-only — production code, tests, build files, CI, issue trackers, and Plans stay untouched;
- describes an empty result as bounded coverage with no candidates noticed.

## Advisory findings

The Init Agent may flag patterns such as:

- an optional object or constructor parameter containing behavioral collaborators;
- production code choosing an injected callback or object when present and a system implementation otherwise;
- mutable global implementations reset by tests;
- production branches explicitly keyed to tests or fake mode;
- tests replacing storage, lifecycle, transactions, registries, locks, orchestration, or other behavior that appears to
  belong to the project;
- broad mocks that prevent most of a feature's real code path from running.

Treat these as discovery hints. Dependency injection can be correct when it represents a genuine external system, and
ownership requires evidence beyond a name. Every finding must include:

- the exact file and construct observed;
- what behavior appears replaceable;
- why that behavior may belong to the project rather than an external system;
- what fixture environment could exercise the real implementation;
- an explicit confidence level and the facts that remain uncertain.

Ordinary data/configuration parameters, test fixtures, and external-system fakes stay out of the report even when they
use a similar syntax.

## User-owned disposition

End initialization with a `Possible test-seam risks` section. If there are no findings, say only that no candidates were
noticed during bounded initialization.

For each candidate, the user decides whether to:

- dismiss it as a legitimate external boundary;
- record it in the repository's existing issue system;
- ask RunWield to create a Plan for a fixture-based refactor;
- leave it unpersisted for now.

The Init Agent asks the user where accepted issues belong. Repositories may use GitHub Issues, Jira, Linear, local
Markdown, Plans, or no tracker. It surfaces the candidates in the Init result and asks before writing to any persistent
issue surface. Memory and domain language record established project facts only; speculative findings stay out of both.

## Scope boundary: advisory discovery only

The feature ships as advisory discovery inside the Init result. This Plan explicitly prohibits adding `wld check`, a
source analyzer, a cross-language manifest, or generated enforcement commands. RunWield's private seam scanner
(`scripts/check-injection-seams.js`), its baseline (`scripts/injection-seam-baseline.json`), the `seams:check` Deno
task, the `src/`/`scripts/` roots, and internal Port type names (`ValidationSessionPort`, `ExecutionStartPorts`) remain
repository-local implementation details and stay out of the customer-facing Init prompt (OC3).

A project may independently choose to turn an accepted finding into a native lint rule, architecture test, or CI check.
That is a separate project change using its own language and tooling, which the user can request explicitly.

## Implementation steps

1. **Reference `write-tests` explicitly.** In `src/agent-definitions/subagent-definitions/init-agent-prompt.md`, tell
   the Init Agent to read the bundled `write-tests` skill before evaluating test seams, and state the ownership rule in
   language-neutral terms: tests must not replace product-owned machinery; only genuine external systems earn fakes. Use
   the phrase `product-owned machinery` — already canonical in
   `src/agent-definitions/shared-practice/architecture-vocabulary.md` — not RunWield's internal seam vocabulary. The
   Init definition (`SUBAGENTS.INIT` in `src/shared/session/subagent-definitions.ts`) composes no shared-practice
   fragments, so this guidance goes directly into the Init prompt file.
2. **Add bounded discovery guidance.** Inspect representative production composition and tests after the existing
   architecture map is understood. Keep the audit bounded to those representative examples.
3. **Define the advisory report.** Require evidence, ownership reasoning, fixture direction, confidence, and uncertainty
   for every candidate.
4. **Keep disposition with the user.** Surface findings in the Init result and ask before creating a Plan or writing to
   the repository's existing issue tracker. Persistence requires an explicit user choice.
5. **Pin no-leak behavior.** The named contract test
   `Init prompt teaches seam-risk guidance without leaking RunWield internals` in
   `src/shared/session/subagent-definitions.test.ts` loads the composed Init prompt through
   `loadSubAgentDefinition(SUBAGENTS.INIT)`. It asserts that the composed prompt contains the required advisory
   guidance, then iterates over a `forbiddenInternalIdentifiers` list and asserts that each value is absent. The list
   includes `check-injection-seams`, `seams:check`, `injection-seam-baseline`, `ValidationSessionPort`,
   `ExecutionStartPorts`, and `src/`/`scripts/` layout references. Inert strings or a test that never loads the composed
   prompt do not satisfy this step.
6. **Document the feature honestly.** Add it to `docs/user-facing-features.md` (beside the existing `wld init`
   capability entries) as advisory discovery with bounded coverage, not enforcement or a clean bill of health. Add the
   `Possible test-seam risks` report section as a defined term in `docs/domain-language.md`.

## Verification

- Run OC1 through OC3.
- Prompt-contract tests prove the Init Agent names `write-tests`, uses the language-neutral ownership rule, reports
  possible issues, and leaves disposition to the user.
- Fixture prompt scenarios cover a likely internal fake, a legitimate external boundary, and an ambiguous construct; the
  expected result respectively flags, omits, and flags-with-uncertainty.
- Mutation proof: make the prompt automatically create a Plan, write Memory, claim a clean result, or mention a
  RunWield-private checker; confirm the focused contract test fails.
- Run type check, lint, documentation links, focused Init/subagent tests, and full CI.

## Preserved behavior

- Existing Init indexing, architecture discovery, Memory seeding, bundled assets, model setup, domain-language output,
  and init-state recording remain unchanged.
- Init still modifies only the project artifacts it already owns unless the user explicitly authorizes another action.
- No test or Init run touches the user's real home, settings, Plans, issue trackers, browser, model credentials, or
  another checkout.
