import { assert, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createGoldenIsolatedEnvironment } from "./isolated-environment.js";

Deno.test("createGoldenIsolatedEnvironment creates isolated HOME and Project then cleans them", async () => {
    const env = await createGoldenIsolatedEnvironment();
    const root = env.root;
    try {
        assert((await Deno.stat(env.home)).isDirectory);
        assert((await Deno.stat(env.projectRoot)).isDirectory);
        assert((await Deno.readTextFile(join(env.projectRoot, "README.md"))).includes("Golden TUI Fixture"));
    } finally {
        await env.cleanup();
    }
    await assertRejects(() => Deno.stat(root), Deno.errors.NotFound);
});
