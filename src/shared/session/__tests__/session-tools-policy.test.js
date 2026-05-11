import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { CWD } from "../../../constants.js";
import { loadAgentDef, resolveSessionToolNames } from "../agents.js";

const localAgentsDir = join(CWD, ".hns", "agents");
const routerOverridePath = join(localAgentsDir, "router.md");

/**
 * @param {string} path
 */
async function readFileIfExists(path) {
    try {
        return await Deno.readTextFile(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

/**
 * @param {string} path
 * @param {string | null} previous
 */
async function restoreFile(path, previous) {
    if (previous === null) {
        try {
            await Deno.remove(path);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            throw error;
        }
        return;
    }

    await Deno.writeTextFile(path, previous);
}

Deno.test("loadAgentDef preserves per-agent protected tools when override narrows router to read", async () => {
    await Deno.mkdir(localAgentsDir, { recursive: true });

    const override = [
        "---",
        "name: router",
        "model: opencode-anthropic/minimax-m2.5-free",
        'description: "router local override"',
        "tools:",
        "  - read",
        "---",
        "",
        "Local prompt.",
        "",
    ].join("\n");

    const previous = await readFileIfExists(routerOverridePath);
    await Deno.writeTextFile(routerOverridePath, override);

    try {
        const def = await loadAgentDef("router");

        const expectedProtected = [
            "memory_recall",
            "memory_recall_global",
            "code_search",
            "code_show",
            "code_outline",
            "code_refs",
            "code_impact",
            "code_trace",
            "code_investigate",
            "code_structure",
            "code_impls",
            "code_importers",
            "triage_report",
        ];

        assertEquals(def.tools, ["read", ...expectedProtected]);
        assert(!def.tools.includes("bash"), "non-protected bundled tool should be removable by override");
    } finally {
        await restoreFile(routerOverridePath, previous);
    }
});

Deno.test("resolveSessionToolNames blocks runtime toolNames from re-enabling removed non-protected tools", () => {
    const agentTools = ["read", "memory_recall", "triage_report"];
    const resolved = resolveSessionToolNames(agentTools, ["read", "bash", "triage_report"], []);

    assertEquals(resolved, ["read", "triage_report"]);
    assert(!resolved.includes("bash"));
});

Deno.test("resolveSessionToolNames allows runtime custom tools", () => {
    const resolved = resolveSessionToolNames(["read"], ["read"], ["extension_tool", "read"]);
    assertEquals(resolved, ["read", "extension_tool"]);
});
