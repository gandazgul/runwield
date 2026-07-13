import { assert, assertStringIncludes } from "@std/assert";
import {
    AGENT_DEFS_DIR,
    CATPPUCCIN_MOCHA_THEME_PATH,
    PROMPT_TEMPLATES_DIR,
    SKILLS_DIR,
    SNIP_FILTERS_DIR,
    SYSTEM_PROMPT_TEMPLATE_PATH,
} from "./constants.js";

Deno.test("bundled resource constants point to file-readable assets", async () => {
    assertStringIncludes(await Deno.readTextFile(CATPPUCCIN_MOCHA_THEME_PATH), "catppuccin-mocha");
    assertStringIncludes(await Deno.readTextFile(SYSTEM_PROMPT_TEMPLATE_PATH), "{{AGENT_PROMPT}}");

    for (const dir of [AGENT_DEFS_DIR, PROMPT_TEMPLATES_DIR, SKILLS_DIR, SNIP_FILTERS_DIR]) {
        const entries = [];
        for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
        assert(entries.length > 0);
    }
});
