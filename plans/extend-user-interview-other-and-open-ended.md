---
classification: "FEATURE"
complexity: "LOW"
summary: "Enhance the `user_interview` tool to support open-ended responses in multiple-choice and yes/no questions. This involves adding an `allowOther` boolean to `multipleChoiceQuestionSchema` and `yesNoQuestionSchema`, updating the validation and execution logic to handle \"Other\" responses, and ensuring the existing `text` question type is clearly positioned as the primary open-ended option."
affectedPaths:
  - "src/tools/user-interview.js"
createdAt: "2026-05-04T00:00:00.000Z"
updatedAt: "2026-05-04T13:52:48.868Z"
status: "approved"
origin: "triage"
---
## Objective

Enhance `user_interview` so agents can collect freeform responses in two additional ways: (1) optional typed “Other” responses on `yes_no` and `multiple_choice` questions captured with structured fields, and (2) an explicit open-ended question type (implemented as a `text`-equivalent alias) while preserving existing behavior.

## File Impacts

| File | Action | Description |
| --- | --- | --- |
| `src/tools/user-interview.js` | Modify | Extend schemas/types, validation, and question execution flow for `allowOther`; add open-ended alias handling; update tool description/prompt snippet for discoverability. |
| `src/tools/__tests__/user-interview_test.js` | Modify | Add/adjust tests for `allowOther` flow, cancellation/validation edge cases, and new open-ended type alias compatibility. |

## Implementation Steps

- [ ] Step 1: Update question schemas in `src/tools/user-interview.js`:
  - Add optional `allowOther: boolean` to `yesNoQuestionSchema` and `multipleChoiceQuestionSchema`.
  - Add explicit open-ended type alias support (e.g., `type: "open_ended"`) by sharing the same fields/constraints as current `text`.
  - Keep `additionalProperties: false` behavior intact.

- [ ] Step 2: Update JSDoc typedefs in `src/tools/user-interview.js` to reflect:
  - `allowOther` on yes/no and multiple-choice questions.
  - The expanded question union including the open-ended alias.
  - Answer typing/comments to include structured `otherText` support when “Other” is selected.

- [ ] Step 3: Extend `validateBatch()` to enforce new rules without breaking existing ones:
  - Preserve current ID/prompt/choice/default checks.
  - For `allowOther`, ensure no collisions with reserved sentinel value used internally for the “Other” option.
  - Ensure default handling still validates only real predefined choices.

- [ ] Step 4: Extend `askQuestion()` for `yes_no` with `allowOther`:
  - Add an “Other” option to selection when enabled.
  - If “Other” is selected, immediately prompt for text input and validate non-empty using existing text-answer semantics.
  - Return structured answer fields for this branch (e.g., `value` as sentinel/selection plus `otherText` as typed content), while preserving boolean output for Yes/No selections.

- [ ] Step 5: Extend `askQuestion()` for `multiple_choice` with `allowOther`:
  - Append an “Other” option when enabled.
  - If selected, prompt for freeform text and return structured answer fields (e.g., selected value plus `otherText`) with label metadata indicating Other.
  - Preserve existing return behavior when selecting predefined choices.

- [ ] Step 6: Add open-ended alias execution behavior in `askQuestion()`:
  - Route the new type through the same text prompt path and validation rules used by `text`.
  - Keep `text` as the primary canonical open-ended behavior to avoid regressions.

- [ ] Step 7: Update/expand tests in `src/tools/__tests__/user-interview_test.js`:
  - New passing cases for `yes_no` with `allowOther` returning structured output (`otherText`).
  - New passing cases for `multiple_choice` with `allowOther` returning structured output (`otherText`).
  - Cancellation and empty-other-text validation behavior.
  - Open-ended alias parity with `text` (default, placeholder, allowEmpty behavior).
  - Regression coverage to confirm existing yes/no, text, and multiple-choice flows still pass.

- [ ] Step 8: Update tool messaging strings in `src/tools/user-interview.js` (`description` and `promptSnippet`) so agents are guided to use:
  - yes/no and multiple-choice with optional “Other” when appropriate.
  - `text`/open-ended questions for fully freeform input.

## Verification Plan

- Run targeted tests:
  - `deno test src/tools/__tests__/user-interview_test.js`
- Run full CI:
  - `deno run ci`
- Expected results:
  - Existing tests remain green.
  - New tests verify:
    - `allowOther` paths for yes/no and multiple-choice collect typed user input and emit the expected structured output fields.
    - Canceling at either select or follow-up text prompt returns `status: "canceled"` with proper metadata.
    - Empty “Other” input yields `validation_error` when empties are disallowed.
    - Open-ended alias behaves equivalently to `text`.

## Edge Cases & Considerations

- Backward compatibility: existing consumers may assume `yes_no` answers are always boolean and `multiple_choice` values always map to predefined choices; with `allowOther`, structured `otherText` must be handled safely. Ensure this is documented in typedefs/tests.
- Sentinel safety: if an internal value like `"other"` is used for selection plumbing, avoid collisions with user-defined multiple-choice values.
- UX consistency: follow-up prompt wording for “Other” should be explicit (e.g., "Please specify") and cancellable.
- Validation consistency: reuse existing text validation behavior so “Other” input follows the same trimming/empty rules as text/open-ended questions.
