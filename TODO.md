# TODO

- [ ] more tests
- [ ] Start implementing the code indexing (Deferred: cymbal is good for now)
- [ ] Auto-sleep: trigger memory consolidation automatically at session end when a threshold is crossed (e.g.,
      memories_added_since_last_sleep >= 10 OR total_memory_count > 50). Show brief "Running memory consolidation..."
      before exit. Natural boundary — user is done, latency acceptable, fresh context to consolidate.
- [ ] When re-executing a completed plan, warn the user if files in `affectedPaths` have changed since the plan ran.
      Show a list of commits between the plan's `updatedAt` (or `createdAt`) and HEAD as a heads-up before kicking off
      execution again.
- [ ] Plan archiving: move old plans (e.g., completed > N days) into `plans/archive/` so the active plans list stays
      short. Surface archived plans only on explicit request.
- [ ] Look at mastra framework to see if we can incorporate it for better plan management and execution control.
- [ ] when we want to trully restrict an agent's write/edit access we should invoke bash commands with a user that has
      no write permissions on the codebase. This way even if the agent tries to use bash to modify files, it will be
      blocked by the OS permissions. We can create a separate user (e.g., "harns_operator") with read-only access to the
      codebase and run all bash commands from that user context. This adds an extra layer of security and ensures that
      agents cannot bypass their tool restrictions.

- [ ] /reload command to refresh dynamic system-prompt content on the live root AgentSession (memories, skills list,
      HARNS.md). Needed because the root AgentSession is built once per agent switch and bakes these in at construction;
      without /reload, mid-session changes to mnemosyne memories / installed skills / HARNS.md are not visible to the
      active agent until the next agent switch.
- [ ] default to this theme instead? https://github.com/ifiokjr/oh-pi/blob/main/packages/themes/themes/oh-p-dark.json

bugs

- Shift + tab stopped working (thinking level)?
