---
kind: "work_record"
recordId: "2f15e59b-b2fb-4948-83d8-4653905a34b0"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-26T22:06:34.501Z"
provenance:
    sourcePlans:
        - "8db5439a-35d9-439b-a434-95f01adf1843"
---

# Frontend Framework Skill Restructured

## Summary

Reworked the bundled frontend-framework Skill into a concise convention-first reference index with separate engineering,
UX, and visual-design guides plus a scoped Apache-2.0 license package. Verification passed via Markdown formatting
checks, bundled-skill release checks, scenario audits, and `deno task ci`.

## Future Planning Notes

The Skill intentionally keeps a broad trigger description so one frontend Skill can cover engineering, UX, and visual
design without introducing another model-invoked skill. Browser mechanics remain delegated to `agent-browser-use`.

## Execution Report

- Reworked `src/skills/frontend-framework/SKILL.md` into a 42-line convention-first reference index with design-basis
  invariant, scoped Apache-2.0 notice, sibling context pointers, and a single conditional `agent-browser-use` pointer.
- Added `ENGINEERING.md`, `UX-DESIGN.md`, `VISUAL-DESIGN.md`, and nested full Apache 2.0 `LICENSE.txt`;
  `src/agent-definitions/frontend-engineer.md` was not modified.
- Static checks passed: SKILL.md Markdown links resolve within `frontend-framework/`; license text includes Apache 2.0
  terms/appendix; visible notice scopes the nested license to this package only.
- Scenario audits passed: routine fixes preserve existing language; partial systems extend minimally;
  greenfield/redesign branches require system discovery plus grounded reusable visual foundations; UX form/async work
  resolves to UX reference; browser mechanics remain in `agent-browser-use`.
- `write-a-skill` critique: model invocation retained with shorter leading-word description; branch granularity and
  progressive disclosure improved; concepts co-located with completion criteria; duplicate loop/browser prose removed.
  Residual trade-off: description remains broad enough to trigger multiple frontend branches, accepted to avoid another
  model-invoked skill.
- Verification passed:
  `deno fmt --check src/skills/frontend-framework/SKILL.md src/skills/frontend-framework/ENGINEERING.md src/skills/frontend-framework/UX-DESIGN.md src/skills/frontend-framework/VISUAL-DESIGN.md`;
  `deno test -A --no-check scripts/release-check.test.js`; `deno task ci`.
- Browser verification not run: this was Skill Markdown/prompt reference work, not browser-rendered product UI, matching
  the plan's execution policy.
