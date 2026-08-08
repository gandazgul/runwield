#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env

/**
 * Type-check every production and test source file.
 *
 * This used to be a shell one-liner built from `src/**` globs. POSIX `sh` has no
 * recursive glob — `**` collapses to `*` — so `src/**\/*.js` only ever matched two
 * levels deep. Files below that were checked only when something shallower imported
 * them, which meant no test file under `src/<area>/<module>/` was checked at all: test
 * files are leaves, so nothing imports them back into the graph. Real type errors sat
 * green for as long as they stayed in a deep enough directory.
 *
 * Walking the tree here fixes that and removes the shell from the equation: the file
 * list is passed as argv, so nothing depends on word-splitting behaviour that differs
 * between `sh`, `bash` and `zsh`.
 */

import { walkSourceFiles } from "./source-files.js";
import { runWithSnip, writeSnipCommandResult } from "./run-with-snip.ts";

if (import.meta.main) {
    const files = await walkSourceFiles();
    const result = await runWithSnip("deno", ["check", "--doc", ...files], {
        failureLabel: "type checks",
    });
    await writeSnipCommandResult(result);
    Deno.exit(result.code);
}
