import { assertEquals } from "@std/assert";
import { isRunWieldOwnedRuntimePath, RUNWIELD_OWNED_RUNTIME_PATHS } from "./runwield-owned-paths.ts";

Deno.test("RunWield owned runtime path predicate covers only enumerated runtime state", () => {
    for (const path of RUNWIELD_OWNED_RUNTIME_PATHS) {
        assertEquals(isRunWieldOwnedRuntimePath(path), true, path);
        assertEquals(isRunWieldOwnedRuntimePath(`${path}/child.json`), true, `${path}/child.json`);
    }

    for (
        const path of [
            ".wld/settings.json",
            ".wld/agents/a.md",
            ".wld/skills/s/SKILL.md",
            ".wld/prompt-templates/a.md",
            ".wld",
            ".wldx/plan-locks/a.lock",
            "src/main.js",
        ]
    ) {
        assertEquals(isRunWieldOwnedRuntimePath(path), false, path);
    }
});
