---
kind: "work_record"
recordId: "94b82c81-ed72-45ed-a2fe-495b7abe143b"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-06T16:38:27.187Z"
provenance:
    sourcePlans:
        - "fba5a66e-a528-4abf-bad8-e9b109625a75"
    evidence:
        - path: "docs/plans/move-domain-language-out-of-context-files.md"
          note: "Plan Front Matter contains accepted Objective-Failing Check waivers."
---

# Moved domain language out of CONTEXT files

## Summary

RunWield now uses canonical domain-language paths: `docs/domain-language.md`, `docs/domain-language-map.md`, and
per-context `domain-language.md`. The implementation added temporary exact-uppercase legacy migration at CLI startup,
moved the CLI implementation to TypeScript while preserving `src/cli.ts`, updated shipped Agent/Skill/init/docs
guidance, and added focused migration coverage. Verification passed with targeted tests and full `deno task ci` at 248
files passed / 0 failed.

## Deviations from Plan

OC2 could not run as written on the case-insensitive temporary filesystem because `CONTEXT.md` and `context.md` cannot
coexist there. The exact-uppercase and lowercase behaviors were verified separately, and the objective check was waived
with user notes. OC5 passed under the Verification Plan exclusion for historical Plan records, but the literal command
still reports legacy names in `docs/plans/`.

## Future Planning Notes

Case-sensitive filename migration checks must account for the host filesystem. Future checks that require distinct paths
differing only by case need a case-sensitive fixture or separate scenario assertions.

## Objective Check Waivers

- 2026-08-06T15:39:17.607Z (mechanical_validation) OC2: Objective check requires a case-sensitive filesystem path
  distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while
  $t/p/context.md must exist. Command: bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p
  "$t/p" "$t/h"; printf legacy >"$t/p/CONTEXT.md"; printf lower >"$t/p/context.md"; (cd "$t/p" && HOME="$t/h"
  MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test ! -e "$t/p/CONTEXT.md";
  test "$(cat "$t/p/docs/domain-language.md")" = legacy; test "$(cat "$t/p/context.md")" = lower' User note: that check
  would require a case sensitive file system. The code is handling this correctly.
- 2026-08-06T15:50:53.080Z (mechanical_validation) OC2: Objective check requires a case-sensitive filesystem path
  distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while
  $t/p/context.md must exist. Command: bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p
  "$t/p" "$t/h"; printf legacy >"$t/p/CONTEXT.md"; printf lower >"$t/p/context.md"; (cd "$t/p" && HOME="$t/h"
  MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test ! -e "$t/p/CONTEXT.md";
  test "$(cat "$t/p/docs/domain-language.md")" = legacy; test "$(cat "$t/p/context.md")" = lower' User note: this will
  never work on case-insensitive file systems
- 2026-08-06T16:06:20.671Z (mechanical_validation) OC2: Objective check requires a case-sensitive filesystem path
  distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while
  $t/p/context.md must exist. Command: bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p
  "$t/p" "$t/h"; printf legacy >"$t/p/CONTEXT.md"; printf lower >"$t/p/context.md"; (cd "$t/p" && HOME="$t/h"
  MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test ! -e "$t/p/CONTEXT.md";
  test "$(cat "$t/p/docs/domain-language.md")" = legacy; test "$(cat "$t/p/context.md")" = lower' User note: it would
  only work on a case-insensitive file system
