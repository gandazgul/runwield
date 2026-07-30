import { assertEquals } from "@std/assert";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { wrapPlanSafeFileTool } from "./plan-safe-file-tools.ts";

Deno.test("Plan-safe write wrapper refuses existing canonical Plan overwrite", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-plan-safe-tool-" });
    try {
        await Deno.mkdir(`${cwd}/plans`, { recursive: true });
        await Deno.writeTextFile(`${cwd}/plans/demo.md`, "# Demo\n");
        const tool = wrapPlanSafeFileTool(
            defineTool({
                name: "write",
                label: "write",
                description: "write test",
                parameters: {},
                execute: async () => {
                    await Promise.resolve();
                    return { content: [{ type: "text", text: "wrote" }], details: null };
                },
            }),
            { cwd, mode: "write" },
        );
        const result = /** @type {{ isError?: boolean }} */ (await tool.execute(
            "call",
            /** @type {any} */ ({ path: "plans/demo.md", content: "# New" }),
            undefined,
            undefined,
            /** @type {any} */ (undefined),
        ));
        assertEquals(result.isError, true);
        assertEquals(await Deno.readTextFile(`${cwd}/plans/demo.md`), "# Demo\n");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
