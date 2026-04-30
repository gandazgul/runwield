- [ ] Allow steering
- [ ] Start implementing the code indexing
- [ ] more test
- [ ] do another code review and optimization pass with Opus 4.6
- [ ] Write tests for the TUI how? avoid TUI regressions in rendering and keymap handling
- [ ] formalize plan statuses and make sure they are used consistently. Plans should start as `draft`, then move to
      `in_review` when submitted for review, and finally `approved`. When a plan is completed, it should be marked as
      `completed`. Resuming a completed plan should show a warning but if the user confirms, it should be allowed then
      reset back to `in_review`.
- [ ] Session management: implement a way to save and load sessions. Implement all the same tools pi has fork, merge,
      etc
