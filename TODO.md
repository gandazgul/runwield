- [ ] do another code review and optimization pass with Opus 4.6
- [ ] more tests
- [ ] Write tests for the TUI how? avoid TUI regressions in rendering and keymap handling
- [ ] Allow steering
- [ ] Start implementing the code indexing
- [ ] formalize plan statuses and make sure they are used consistently. Plans should start as `draft`, then move to
      `in_review` when submitted for review, and finally `approved`. When a plan is completed, it should be marked as
      `completed`. Resuming a completed plan should show a warning but if the user confirms, it should be allowed then
      reset back to `in_review`.
- [ ] Session management: implement a way to save and load sessions. Implement all the same tools pi has fork, merge,
      etc
- [ ] Auto-sleep: trigger memory consolidation automatically at session end when a threshold is crossed (e.g.,
      memories_added_since_last_sleep >= 10 OR total_memory_count > 50). Show brief "Running memory consolidation..."
      before exit. Natural boundary — user is done, latency acceptable, fresh context to consolidate.

gpt-5.3-codex

I would like to implement skills loading like Pi does. Using the standard anthropic skills format. Spec:
@docs/skills-spec.md and Implementation details: @docs/adding-skills-support.md see how Pi does it but make sure the
spec is followed.
