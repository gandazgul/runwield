- [ ] do another code review and optimization pass with Opus 4.6 I did of the cmd files but more is needed. I also told
      it to optimize the uiAPI and I seem to have stabilized it.
- [ ] more tests
- [ ] Start implementing the code indexing
- [ ] Session management: Implement all the same tools pi has fork, merge, etc
- [ ] Auto-sleep: trigger memory consolidation automatically at session end when a threshold is crossed (e.g.,
      memories_added_since_last_sleep >= 10 OR total_memory_count > 50). Show brief "Running memory consolidation..."
      before exit. Natural boundary — user is done, latency acceptable, fresh context to consolidate.
