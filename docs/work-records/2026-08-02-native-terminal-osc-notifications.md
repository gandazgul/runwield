---
kind: "work_record"
recordId: "5fc75401-ff91-49a3-a893-3f3cdc6050d1"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-02T21:46:32.503Z"
tickets:
    - url: "https://github.com/anomalyco/opencode/issues/4454"
provenance:
    sourcePlans:
        - "7525b0d3-0dbe-4b0b-a3fa-ce7cacb8de1a"
---

# Native Terminal OSC Notifications

## Summary

Replaced macOS command-based TUI notifications with native terminal OSC/BEL delivery and focused-terminal suppression.
The implementation now selects Kitty OSC 99, WezTerm/Ghostty OSC 777, iTerm2 OSC 9, or unsupported BEL fallback;
sanitizes notification text; defaults `suppressWhenFocused` to true; tracks terminal focus state through xterm focus
reporting; filters focus bytes from input; and updates TUI lifecycle cleanup, imports, docs, and TypeScript tests.
Verification covered targeted notification/focus tests, OC1-OC3, check, lint, seams, and reruns of initially failing
golden/workspace tests.

## Deviations from Plan

The final full `deno task test` did not pass cleanly because `src/ui/tui/golden-scenarios/concurrent-workflow.test.ts`
hit a Golden child idle timeout after 120000ms, though that file passed when rerun with the other initially failing
files. `scripts/injection-seam-baseline.json` was not changed because the existing seam baseline still held.

## Deferred Work

Manual terminal checks in iTerm2, Ghostty, WezTerm, Kitty, and Terminal.app were not run in this environment, so native
click-to-focus behavior remains manually unverified.

## Future Planning Notes

Terminal-native notification work should keep protocol behavior isolated in the TUI layer, preserve Golden TUI
suppression, and treat focus as suppressible only when known focused; unknown focus should continue to notify.

## Execution Report

- Implemented native terminal OSC notifications in `src/ui/tui/system-notifications.ts`: Kitty OSC 99 (`o=unfocused`),
  WezTerm/Ghostty OSC 777, iTerm2 OSC 9, unsupported BEL fallback, text sanitization, focused-terminal suppression, and
  `suppressWhenFocused` default `true`; command-based notifier helpers and imports were removed.
- Added `src/ui/tui/terminal-focus-state.ts` and wired production TUI lifecycle cleanup to enable/disable xterm focus
  reporting and filter focus input; explicit test pairs stay opt-in, and Golden TUI env skips focus-reporting bytes.
- Updated runtime/slash-dispatch imports and `docs/settings.md`; `scripts/injection-seam-baseline.json` was not changed
  because `deno task seams:check` still holds the existing baseline.
- Test coverage changed from 19 replaced system-notification JS tests to 21 TS tests (+2): command-delivery tests for
  terminal-notifier grouping, osascript fallback, sender/activation scripts, exact-tab activation, command failure
  fallback, and desktop delivery were replaced because those command behaviors no longer exist; defaults/settings,
  terminal identity, Golden suppression, disabled/unknown events, bell behavior, compaction text, context text, write
  failures, protocol selection, sanitization, focus suppression, and unsupported fallback were rewritten against the
  native OSC/BEL shape; five new focus-state tests cover enable/disable, state transitions, filtering, passthrough, and
  idempotent disposal.
- Verification passed: targeted tests
  (`deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts`),
  objective checks OC1-OC3, `deno task check`, `deno task lint`, `deno task seams:check`, and rerun of initially failing
  golden/workspace files.
- Verification did not pass cleanly overall: final `deno task test` failed on
  `src/ui/tui/golden-scenarios/concurrent-workflow.test.ts` with a Golden child idle timeout after 120000ms, although
  that file passed when rerun with the other initially failing files.
- Manual terminal checks in iTerm2, Ghostty, WezTerm, Kitty, and Terminal.app were not run in this environment; native
  click-to-focus remains manually unverified.
