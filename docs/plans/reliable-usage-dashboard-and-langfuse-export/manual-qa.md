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

<!-- runwield:manual-qa:start child="reliable-usage-dashboard-and-langfuse-export/02-real-model-usage-across-backends-and-auxiliary-calls" -->

## Real Model Usage Across Backends and Auxiliary Calls

Manual verification steps for
reliable-usage-dashboard-and-langfuse-export/02-real-model-usage-across-backends-and-auxiliary-calls

- [ ] Run a session with missing usage fields; confirm the runtime event, replay totals, and footer show unavailable
      values, not zero.
- [ ] Open a session with compaction usage; confirm replay shows it as a separate component and excludes it from
      assistant totals.
- [ ] Run a vision fallback call with usage; confirm exactly one usage observation contains the reported values. Repeat
      with missing usage and confirm it is marked unavailable.
- [ ] Run Guided Review with measured and missing usage; confirm one aggregated usage observation per settled external
      job and that the outcome event still appears.
- [ ] Review Claude and agy session usage; confirm supplied zero remains zero, absent values remain unavailable, and agy
      cost is never shown as zero.

<!-- runwield:manual-qa:end child="reliable-usage-dashboard-and-langfuse-export/02-real-model-usage-across-backends-and-auxiliary-calls" -->
