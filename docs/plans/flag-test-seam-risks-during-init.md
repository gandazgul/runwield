---
planId: "e16197ef-5655-4ea4-a410-bf23427a85c6"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Teach the universal fake-external-systems rule during initialization and have the Init Agent report evidence-backed possible dependency-seam risks for the user to classify, without adding a cross-language checker or exporting RunWield internals."
affectedPaths:
    - "docs/plans/flag-test-seam-risks-during-init.md"
    - "docs/testing.md"
    - "docs/user-facing-features.md"
    - "src/agent-definitions/shared-practice/"
    - "src/agent-definitions/subagent-definitions/init-agent-prompt.md"
    - "src/shared/session/subagent-definitions.test.ts"
    - "src/skills/write-tests/"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'Possible test-seam risks' src/agent-definitions/subagent-definitions/init-agent-prompt.md && deno run -A scripts/run-tests.js src/shared/session/subagent-definitions.test.ts"
      rationale: "The Init Agent must explicitly report uncertain seam findings instead of silently classifying or fixing them."
    - id: "OC2"
      command: "grep -q 'write-tests' src/agent-definitions/subagent-definitions/init-agent-prompt.md && grep -q 'product-owned machinery' src/agent-definitions/subagent-definitions/init-agent-prompt.md"
      rationale: "Initialization must use the shared testing practice by name and preserve the ownership rule in language-neutral terms."
    - id: "OC3"
      command: "! grep -qE 'check-injection-seams|external-capability-ports|deno task seams|ValidationSessionPort|ExecutionStartPorts' src/agent-definitions/subagent-definitions/init-agent-prompt.md"
      rationale: "Customer-facing initialization must not expose RunWield's private scanner, build commands, manifest, or module names."
createdAt: "2026-08-04T23:55:00-0400"
updatedAt: "2026-08-18T14:30:00-0400"
status: "draft"
origin: "user"
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

Initialization already explores each repository deeply enough to notice suspicious examples. It should surface those
examples as possible issues for the user to classify, not create a universal `wld check` framework.

## Objective

Extend the Init Agent so it:

- reads the bundled `write-tests` skill and applies its ownership rule in the repository's own language and terms;
- looks for concrete signs that tests can replace product-owned behavior;
- distinguishes confirmed syntax from an ownership judgment that still belongs to the user;
- reports evidence-backed possible issues with file locations and a short explanation;
- asks the user what, if anything, should be persisted or planned;
- does not modify production code, tests, build files, CI, issue trackers, or Plans during discovery;
- never claims the repository is clean merely because it found nothing.

## Advisory findings

The Init Agent may flag patterns such as:

- an optional object or constructor parameter containing behavioral collaborators;
- production code choosing an injected callback or object when present and a system implementation otherwise;
- mutable global implementations reset by tests;
- production branches explicitly keyed to tests or fake mode;
- tests replacing storage, lifecycle, transactions, registries, locks, orchestration, or other behavior that appears to
  belong to the project;
- broad mocks that prevent most of a feature's real code path from running.

These are discovery hints, not universal violations. Dependency injection can be correct when it represents a genuine
external system, and a name alone cannot establish ownership. Every finding must include:

- the exact file and construct observed;
- what behavior appears replaceable;
- why that behavior may belong to the project rather than an external system;
- what fixture environment could exercise the real implementation;
- an explicit confidence level and the facts that remain uncertain.

Do not report ordinary data/configuration parameters, test fixtures, or external-system fakes merely because they use a
similar syntax.

## User-owned disposition

End initialization with a `Possible test-seam risks` section. If there are no findings, say only that no candidates were
noticed during bounded initialization; do not call that proof.

For each candidate, the user decides whether to:

- dismiss it as a legitimate external boundary;
- record it in the repository's existing issue system;
- ask RunWield to create a Plan for a fixture-based refactor;
- leave it unpersisted for now.

The Init Agent must not guess where issues belong. Repositories may use GitHub Issues, Jira, Linear, local Markdown,
Plans, or no tracker. It surfaces the candidates in the Init result and asks before writing to any persistent issue
surface. Speculative findings must not be stored as established project facts in Memory or domain language.

## No public checker

This Plan does not add `wld check`, a source analyzer, a cross-language manifest, or generated enforcement commands.
RunWield's private seam detector, Deno tasks, `src/`/`scripts/` roots, Port naming, internal modules, and internal
external-capability declaration remain repository-local implementation details.

A project may independently choose to turn an accepted finding into a native lint rule, architecture test, or CI check.
That is a separate project change using its own language and tooling, not something Init installs automatically.

## Implementation steps

1. **Reference `write-tests` explicitly.** Add it to the Init Agent's applicable practice and tell the Agent to read it
   before evaluating test seams.
2. **Add bounded discovery guidance.** Inspect representative production composition and tests after the existing
   architecture map is understood. Do not turn Init into an exhaustive repository audit.
3. **Define the advisory report.** Require evidence, ownership reasoning, fixture direction, confidence, and uncertainty
   for every candidate.
4. **Keep disposition with the user.** Surface findings in the Init result and ask before creating a Plan or writing to
   the repository's existing issue tracker. Persist nothing automatically.
5. **Pin no-leak behavior.** Prompt tests reject RunWield's internal checker names, module names, Deno commands, source
   layout, or Port-type manifest from the bundled Init prompt.
6. **Document the feature honestly.** Describe it as advisory discovery with bounded coverage, not enforcement or a
   clean bill of health.

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
