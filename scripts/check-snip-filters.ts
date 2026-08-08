#!/usr/bin/env -S deno run -A

import { basename, join } from "@std/path";
import { SNIP_FILTERS_DIR } from "../src/constants.js";

const FILTERS = ["deno-check.yaml", "deno-fmt.yaml", "deno-lint.yaml", "deno-test.yaml"];

function assertGenericFilter(fileName: string, content: string): void {
    if (!content.includes('command: "deno"')) throw new Error(`${fileName} does not match Deno directly.`);
    if (!content.includes('on_error: "fail"')) throw new Error(`${fileName} must fail closed on pipeline errors.`);
    if (/runwield|harns|\bhns\b|scripts\//i.test(content)) {
        throw new Error(`${fileName} contains repository-specific matching.`);
    }
}

export async function checkSnipFilters(): Promise<void> {
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-snip-check-" });
    try {
        const filtersDir = join(tempHome, ".config", "snip", "filters");
        await Deno.mkdir(filtersDir, { recursive: true });
        for (const fileName of FILTERS) {
            const content = await Deno.readTextFile(join(SNIP_FILTERS_DIR, fileName));
            assertGenericFilter(fileName, content);
            await Deno.writeTextFile(join(filtersDir, fileName), content);
        }

        const configPath = join(tempHome, ".config", "snip", "config.toml");
        await Deno.writeTextFile(
            configPath,
            `[tracking]\ndb_path = "${
                join(tempHome, "tracking.db")
            }"\n\n[filters]\ndir = "${filtersDir}"\n\n[tee]\nenabled = false\n`,
        );
        const result = await new Deno.Command("snip", {
            args: ["verify"],
            env: { ...Deno.env.toObject(), HOME: tempHome, SNIP_CONFIG: configPath },
            stdout: "piped",
            stderr: "piped",
        }).output();
        const decoder = new TextDecoder();
        const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;
        if (!result.success) throw new Error(`Snip filter verification failed:\n${output}`);
        for (const fileName of FILTERS) {
            const name = basename(fileName, ".yaml");
            if (!new RegExp(`^${name} \\.{3,} [0-9]+/[0-9]+ passed$`, "m").test(output)) {
                throw new Error(`Snip did not verify ${name}.\n${output}`);
            }
        }
        console.log("Snip verified all generic Deno filters.");
    } finally {
        await Deno.remove(tempHome, { recursive: true }).catch(() => {});
    }
}

if (import.meta.main) await checkSnipFilters();
