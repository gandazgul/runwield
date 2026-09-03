import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

interface DenoConfig {
    tasks: Record<string, string>;
}

const GOLDEN_TUI_DIRS = ["src/ui/tui/golden-scenarios", "src/ui/tui/testing"];

async function readDenoConfig(): Promise<DenoConfig> {
    return JSON.parse(await Deno.readTextFile(new URL("../deno.json", import.meta.url))) as DenoConfig;
}

Deno.test("the everyday test task leaves the Golden TUI portfolio to its own task", async () => {
    const { tasks } = await readDenoConfig();

    for (const dir of GOLDEN_TUI_DIRS) {
        assertStringIncludes(tasks.test, `--exclude ${dir}`);
        assertStringIncludes(tasks["test:golden-tui"], dir);
    }
});

Deno.test("the PR gate runs source quality and then the Golden TUI portfolio", async () => {
    const { tasks } = await readDenoConfig();
    const workflow = await Deno.readTextFile(new URL("../.github/workflows/pr.yml", import.meta.url));

    assertEquals(tasks["pr:check"], "deno task ci && deno task test:golden-tui");
    assertStringIncludes(workflow, "pull_request:");
    assertStringIncludes(workflow, "deno task pr:check");
});

Deno.test("the test runner skips excluded paths it would otherwise discover", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-exclude-policy-" });
    try {
        await Deno.writeTextFile(
            join(root, "passes.test.ts"),
            'Deno.test("passes", () => {});\n',
        );
        await Deno.writeTextFile(
            join(root, "fails.test.ts"),
            'Deno.test("fails", () => {\n    throw new Error("this file must never run");\n});\n',
        );

        const result = await new Deno.Command(Deno.execPath(), {
            args: [
                "run",
                "-A",
                new URL("./run-tests.js", import.meta.url).pathname,
                "--isolated",
                root,
                "--exclude",
                join(root, "fails.test.ts"),
            ],
            stdout: "piped",
            stderr: "piped",
        }).output();

        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        assertEquals(result.code, 0, output);
        assertStringIncludes(output, "1 files passed");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
