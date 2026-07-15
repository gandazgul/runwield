---
kind: work_record
recordId: 9ccacfea-705e-4268-a70c-d944a7ea542f
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-15T11:06:24-04:00
provenance:
    evidence:
        - path: src/agent-definitions/workflow-prompts/manual-qa-prompt.md
          note: Defines the user-facing Markdown checklist contract and manual-only QA guidance.
        - path: src/shared/workflow/validation.js
          note: Runs the isolated checklist prompt after successful QUICK_FIX and FEATURE validation.
        - path: src/shared/workflow/orchestrator.js
          note: Supplies QUICK_FIX request and implementation-summary context to post-verification checklist generation.
        - path: src/shared/session/agent-handler.js
          note: Restores preserved checklist context when QUICK_FIX validation resumes after an interrupted repair.
---

# Post-Verification Manual QA Checklists

## Summary

RunWield now follows successful QUICK_FIX Mechanical Validation and FEATURE Workflow Validation with a concise manual
verification checklist for the user. FEATURE checklists are grounded in the Plan, while QUICK_FIX checklists use the
original request and the Engineer's completion summary; interrupted QUICK_FIX repair flows retain that context when
validation resumes. Failed or canceled validation does not produce a checklist, and checklist-generation failures are
reported without retroactively invalidating successful automated verification. This gives users a clear final set of
observable checks while keeping automated and manual verification responsibilities distinct.
