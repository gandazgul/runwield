| Priority | User journey                    | Current coverage                                                               | Missing proof                                                                                                                                     |
| -------- | ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3        | Authentication onboarding       | `/login` only tests cancellation; `/logout` only tests having no credentials.  | Successful login → provider/model selection → first message, persisted credentials, real logout, and failed-auth recovery.                        |
| 4        | Session resume                  | `/resume` only tests “no recent sessions.”                                     | Select a real session, restore history/Agent/model/Plan state, send another message, and survive corrupt or interrupted sessions.                 |
| 5        | Real compaction                 | `/compact` only tests “Nothing to compact.”                                    | Compact a populated conversation, verify the summary/context, then continue successfully without losing Agent/model/workflow state.               |
| 6        | Init recovery                   | Successful startup init and already-initialized behavior are covered.          | User declines, Init Agent fails, artifact is missing, retry succeeds, and partial initialization is recovered safely.                             |
| 7        | Settings persistence            | `/settings` only selects “Done”; `/theme` changes the current selection.       | Actually edit each important setting, verify immediate behavior, restart the application, and verify persistence.                                 |
| 8        | Agent/model restart persistence | The new scenarios prove precedence and subsequent messages within one process. | Restart/resume the session and prove the manual model and selected Agent remain effective.                                                        |
| 9        | Slash-command happy paths       | `/share` only tests missing gh; `/copy` only tests no assistant message.       | Successful sharing and copying, plus their real failure/retry paths.                                                                              |
| 10       | Validation branch precision     | Broad validation and repair coverage is extensive.                             | Independently prove objective:none versus objective:all-pass, and human-review:none versus human-review:ask-skip; they currently share scenarios. |

Suggested sequence

I would order the overlapping group like this:

1. Finish remove-return-to-router-user-owned-transitions.md It is already in_progress, and the Engineer split explicitly
   depends on it. - done

   1. finish-agent-prompt-architecture-cleanup - done

2. resume-validation-after-repair-completion.md Small ready bug fix. Stabilizes validation repair. - done

3. split-quick-fix-engineer-from-plan-engineer.md This should absorb/supersede
   generalize-pair-execution-to-engineer.md. - done

4. Reassess/archive mode-specific-engineer-context.md and generalize-pair-execution-to-engineer.md (this one is done).

   1. docs/plans/execution-agent-context-boundaries.md - done
   2. parallelize-independent-ci-stages.md - done

5. classify-validation-operational-errors.md - done

6. flag-test-seam-risks-during-init.md - done

7. Optional before foundation: guided-validation-repair.md - done

8. simplify-validation-and-lifecycle-messages.md Better after the error/repair model is stable. - done

9. plan-packages-and-independent-validation.md

10. plan-package-frontend-experience-planning.md

11. epic-branch-publication-workflow.md

## In this screen we should offer an option to see the diff

RunWield Plan amendment: pick what to do.

The Engineer offered a Plan amendment for workspace-session-screen-mvp:

- body: changed

The Engineer offered a Plan amendment for workspace-session-screen-mvp:

- body: changed

Do you approve this Plan change?

→ Approve Plan changes Engineer follow-up Stop

Type to search, arrows to navigate, Enter to select, Esc to cancel
