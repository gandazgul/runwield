import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { migratePiModelConfigOnce } from "./model-registry.js";

Deno.test("migratePiModelConfigOnce copies Pi files into Harns when missing", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi", "agent");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "models.json"), '{"providers":{}}');
        await Deno.writeTextFile(join(piDir, "auth.json"), '{"openai":{"type":"api_key","key":"abc"}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied.sort(), ["auth.json", "models.json"]);
        assertEquals(result.failed, []);
        assertEquals(await Deno.readTextFile(join(harnsDir, "models.json")), '{"providers":{}}');
        assertEquals(await Deno.readTextFile(join(harnsDir, "auth.json")), '{"openai":{"type":"api_key","key":"abc"}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("migratePiModelConfigOnce leaves existing Harns files untouched", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi", "agent");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.mkdir(harnsDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "models.json"), '{"providers":{"pi":{}}}');
        await Deno.writeTextFile(join(harnsDir, "models.json"), '{"providers":{"harns":{}}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied, []);
        assertEquals(await Deno.readTextFile(join(harnsDir, "models.json")), '{"providers":{"harns":{}}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("migratePiModelConfigOnce supports legacy ~/.pi file location", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "auth.json"), '{"openai-codex":{"type":"oauth"}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied, ["auth.json"]);
        assertEquals(await Deno.readTextFile(join(harnsDir, "auth.json")), '{"openai-codex":{"type":"oauth"}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});
