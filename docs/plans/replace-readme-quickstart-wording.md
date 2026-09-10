---
planId: "1c6f85b7-b9e9-45b4-8217-20e1ce546a1c"
classification: "PLANNED_CHANGE"
workKind: "DOCUMENTATION"
complexity: "LOW"
affectedPaths:
  - "README.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-10T15:42:20-04:00"
status: "validated_reviewer"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "README Quickstart Wording"
targetBranch: "main"
---

# Replace README Quickstart Wording

## Context

The README currently uses a two-line sentence before the Quickstart Guide link. The wording is informal and does not clearly name model provider authentication or the source-running setup path.

The working tree already contains unrelated acceptance-test and Workspace-repair changes to `.wld/settings.json`, source/test files, and `.wld/internal/`. These are out of scope and must remain untouched, unstaged, and uncommitted by this change.

## Objective

Replace only the sentence immediately before the existing Quickstart Guide link with:

> For setup details, including model provider authentication, runtime helpers, and running from source, see the \[Quickstart Guide\]\(docs/quickstart.md\).

The README link target must remain `docs/quickstart.md`, and all other README content must remain unchanged.

## Approach

Update the existing two-line block in `README.md` as one focused documentation edit. Keep the current link and surrounding beta callout intact.

Before:

```text
For full setup: model provider auth, runtime helpers, running from source, etc check out the
[Quickstart Guide](docs/quickstart.md).
```

After:

```text
For setup details, including model provider authentication, runtime helpers, and running from source, see the [Quickstart Guide](docs/quickstart.md).
```

The alternative of rewriting the surrounding Install section was set aside because it would increase review and publication risk without improving this requested wording.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `README.md` — replace the existing setup sentence only; preserve the Quickstart Guide target and all surrounding content.
- `.wld/settings.json`, `src/tools/__tests__/plan-written.test.js`, `src/tools/plan-written.ts`, `src/ui/workspace/server/session-continuation.js`, `src/ui/workspace/session-continuation.integration.test.ts`, and `.wld/internal/` — deliberately excluded; these are existing acceptance-test setup or Workspace-repair changes and must not be changed, staged, or committed by this workflow.

No domain-language update is needed: this edit uses existing glossary terms and does not introduce or redefine product behavior.

## Reuse Opportunities

- Existing `README.md` Quickstart Guide link — preserve this link rather than adding a second setup link or changing its target.

## Implementation Steps

- `README.md` contains the requested single-sentence wording immediately before the `Quickstart Guide` link targeting `docs/quickstart.md`, with the link target unchanged.
- The only tracked content change attributable to this Plan is the replacement of the old two-line setup sentence; the surrounding Install section, beta callout, and all other README content are unchanged.
- The pre-existing `.wld/settings.json`, source/test edits, and `.wld/internal/` remain untouched and are not included in the implementation commit; only the approved README edit and normal Plan/Work Record artifacts belong to this workflow.

## Approval Confirmation

No Work Record is superseded by this wording-only change.

## Verification Plan

- Automated: run `git diff --check` to confirm the edited Markdown has no whitespace errors.
- Automated: inspect `git diff -- README.md` and confirm it contains exactly the requested sentence replacement, retains `(docs/quickstart.md)`, and contains no other README hunks.
- Automated: inspect `git status --short` and confirm the pre-existing `.wld/settings.json`, source/test edits, and `.wld/internal/` remain untouched and are not staged or committed by the implementation.
- Manual: open the README at the Install section and confirm the sentence renders as one complete line in Markdown source with the Quickstart Guide link immediately following the setup wording.
- Expected result: the final diff is limited to the approved README wording replacement, with no code, configuration, PRD, or ADR changes.

## Edge Cases & Considerations

- Preserve the relative link target exactly as `docs/quickstart.md`; do not change link text, URL, or nearby spacing beyond the requested replacement.
- Do not normalize or rewrite unrelated README formatting.
- The pre-existing `.wld/settings.json` modification must survive the workflow and must not enter the publication commit.
- Publication target is `origin/main`, as authorized by the owner; execution must preserve unrelated work while publishing only the validated README change.
