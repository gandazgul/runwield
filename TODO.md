# TODO

- [x] edit should automatically return the file or a 1000 line chunk if write fails.
- [x] Add this tool multi_replace_file_content
- [ ] Grill me and grill me with code should use ideator and not operator as the base.
- [ ] when using /resume on a long session (we have to define long but probably more than 50% of the small models
      contexts) offer to compact it before loading it.
- [ ] optionally, on by default disable with setting, load skills in ~/.agents/skills
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
- [ ] chaneg the plans statuses: draft -> feedback/approved -> in_progress -> in_review -> completed -> archived.
      Loading the plan changes it back to draft or in_progress.
- [ ] Look at mastra framework to see if we can incorporate it for better plan management and execution control.
- [ ] when we want to trully restrict an agent's write/edit access we should invoke bash commands with a user that has
      no write permissions on the codebase. This way even if the agent tries to use bash to modify files, it will be
      blocked by the OS permissions. We can create a separate user (e.g., "harns_operator") with read-only access to the
      codebase and run all bash commands from that user context. This adds an extra layer of security and ensures that
      agents cannot bypass their tool restrictions.
- [x] Inconsistent post-flow agent state. QUICK_FIX leaves the agent on Operator, while FEATURE/PROJECT leaves it on
      Engineer. (Working as intended; benefits from the new UI stack automatically).
- [x] Unused `_AGENT_REMINDERS` in `agents.js`. Fixed by injecting them at the end of `opts.userRequest` in
      `runAgentSession`.
- [x] Agent workflow loop halts on user questions instead of waiting for a completed signal. Fixed by introducing the
      `task_completed` tool and decoupling the validation loop.

- [ ] /reload command to refresh dynamic system-prompt content on the live root AgentSession (memories, skills list,
      HARNS.md). Needed because the root AgentSession is built once per agent switch and bakes these in at construction;
      without /reload, mid-session changes to mnemosyne memories / installed skills / HARNS.md are not visible to the
      active agent until the next agent switch.
- [ ] default to this theme instead? https://github.com/ifiokjr/oh-pi/blob/main/packages/themes/themes/oh-p-dark.json

bugs

- Shift + tab stopped working (thinking level)?
