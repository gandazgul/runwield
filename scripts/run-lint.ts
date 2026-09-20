#!/usr/bin/env -S deno run -A

import { dirname, fromFileUrl } from "@std/path";
import { listCiFiles } from "./ci-files.ts";
import { runWithSnip, writeSnipCommandResult } from "./run-with-snip.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const LINT_FILE_PATTERN = /\.(?:jsx?|tsx?|mjs|mts)$/;

if (import.meta.main) {
    const files = (await listCiFiles(REPO_ROOT)).filter((path) =>
        LINT_FILE_PATTERN.test(path) && !path.split("/").includes(".astro")
    );
    const result = await runWithSnip(
        "deno",
        ["lint", "--permit-no-files", "--rules-exclude=ban-unknown-rule-code", ...files],
        {
            cwd: REPO_ROOT,
            failureLabel: "lint",
            stdin: "inherit",
        },
    );
    await writeSnipCommandResult(result);
    Deno.exit(result.code);
}
