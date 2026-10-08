# Manual QA for reliable-usage-dashboard-and-langfuse-export

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="reliable-usage-dashboard-and-langfuse-export/01-core-measurement-history-and-default-on-recording" -->

## Core Measurement History and Durable Recording

Manual verification steps for
reliable-usage-dashboard-and-langfuse-export/01-core-measurement-history-and-default-on-recording

- [ ] With recording disabled, perform workflow activity and confirm that no new metrics are recorded; enable recording
      and confirm that new activity is recorded.
- [ ] Disable recording, perform workflow activity, then re-enable it. Confirm that activity from the disabled interval
      is not recorded or replayed, and that the journal shows the observed collection boundary.
- [ ] Open existing v1 metrics before and after recording is enabled. Confirm that the v1 records remain intact and
      readable.
- [ ] Cause a journal write failure or lock timeout. Confirm that workflow work completes and the result reports that
      the measurement was not saved.

<!-- runwield:manual-qa:end child="reliable-usage-dashboard-and-langfuse-export/01-core-measurement-history-and-default-on-recording" -->
