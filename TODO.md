# TODO

- [ ] more tests
- [ ] Start implementing the code indexing (cymbal is good for now)
- [ ] Auto-sleep: trigger memory consolidation automatically at session end when a threshold is crossed (e.g.,
      memories_added_since_last_sleep >= 10 OR total_memory_count > 50). Show brief "Running memory consolidation..."
      before exit. Natural boundary — user is done, latency acceptable, fresh context to consolidate.
- [ ] When re-executing a completed plan, warn the user if files in `affectedPaths` have changed since the plan ran.
      Show a list of commits between the plan's `updatedAt` (or `createdAt`) and HEAD as a heads-up before kicking off
      execution again.
- [ ] Plan archiving: move old plans (e.g., completed > N days) into `plans/archive/` so the active plans list stays
      short. Surface archived plans only on explicit request.
- [ ] Optional plan-review step after `completed`: add an `in_review` state between approved-execution and `completed`
      so a code-review/plan-review pass can sign off before the plan is closed.
- [ ] Look at mastra framework to see if we can incorporate it for better plan management and execution control.

bugs

- when we want to trully restrict an agent's write/edit access we should invoke bash commands with a user that has no
  write permissions on the codebase. This way even if the agent tries to use bash to modify files, it will be blocked by
  the OS permissions. We can create a separate user (e.g., "harns_operator") with read-only access to the codebase and
  run all bash commands from that user context. This adds an extra layer of security and ensures that agents cannot
  bypass their tool restrictions.
- !! is currently sending steering messages instead of executing bash commands.
- Shift + tab stopped working (thinking level)
