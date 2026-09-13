# Core PRD Gap Audit

This report records the Core PRD gap audit that produced the current draft and approved Plans.

## 10. Optional vision configuration and Project isolation

The audit found that optional vision fallback validation could block text-only Agent startup, and fallback resolution
could read settings from the process working directory instead of the active Project. The approved Plan
`docs/plans/fix-project-vision-fallback-submission.md` implements the correction.
