import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { runQuitCommand } from "./index.ts";

const decoder = new TextDecoder();

async function runQuitChild(): Promise<Deno.CommandOutput> {
    const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-quit-command-" });
    const homeDir = join(fixtureRoot, "home");
    const projectRoot = join(fixtureRoot, "project");
    await Promise.all([
        Deno.mkdir(homeDir, { recursive: true }),
        Deno.mkdir(projectRoot, { recursive: true }),
    ]);
    const moduleUrl = import.meta.resolve("./index.ts");
    const configPath = fromFileUrl(new URL("../../../deno.json", import.meta.url));
    const source = [
        `import { runQuitCommand } from ${JSON.stringify(moduleUrl)};`,
        "await runQuitCommand([], {",
        "  editor: { setText(text) { console.log(`editor:${JSON.stringify(text)}`); } },",
        "  tui: { requestRender() { console.log('rendered'); } },",
        "});",
    ].join("\n");
    try {
        return await new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", configPath, source],
            cwd: projectRoot,
            env: {
                HOME: homeDir,
                WLD_TEST_SANDBOX_HOME: homeDir,
            },
            stdout: "piped",
            stderr: "piped",
        }).output();
    } finally {
        await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
    }
}

Deno.test("quit command no-ops without interactive surfaces", async () => {
    await runQuitCommand([], {});
});

Deno.test("quit command clears external UI surfaces and performs real delayed TUI shutdown", async () => {
    const result = await runQuitChild();
    const stdout = decoder.decode(result.stdout);

    assertEquals(result.code, 0);
    assertStringIncludes(stdout, 'editor:""');
    assertStringIncludes(stdout, "rendered");
    assertStringIncludes(stdout, "\x1b]0;\x07");
    assertEquals(decoder.decode(result.stderr), "");
});
