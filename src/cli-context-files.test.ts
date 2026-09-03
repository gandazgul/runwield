import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

async function makeTempDir(prefix: string): Promise<string> {
    return await Deno.makeTempDir({ prefix });
}

async function removeTempDir(path: string): Promise<void> {
    try {
        await Deno.remove(path, { recursive: true });
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function writePlan(projectRoot: string): Promise<void> {
    await Deno.mkdir(join(projectRoot, "docs", "plans"), { recursive: true });
    await Deno.writeTextFile(
        join(projectRoot, "docs", "plans", "context-preservation.md"),
        [
            "---",
            'classification: "PLANNED_CHANGE"',
            'workKind: "BUG_FIX"',
            'complexity: "LOW"',
            'summary: "Keep context files untouched."',
            "affectedPaths: []",
            'createdAt: "2026-08-26T00:00:00Z"',
            'status: "draft"',
            "---",
            "",
            "# Context Preservation",
            "",
        ].join("\n"),
    );
}

Deno.test("CLI commands leave repository CONTEXT files untouched", async () => {
    const projectRoot = await makeTempDir("runwield-cli-context-files-");
    const homeDir = await makeTempDir("runwield-cli-context-home-");
    const rootContext = "Root CONTEXT content owned by another tool.\n";
    const rootMap = "# Context map\n\n- [Nested](./nested/CONTEXT.md)\n";
    const nestedContext = "Nested CONTEXT content owned by another tool.\n";

    try {
        await writePlan(projectRoot);
        await Deno.mkdir(join(projectRoot, "nested"), { recursive: true });
        await Deno.writeTextFile(join(projectRoot, "CONTEXT.md"), rootContext);
        await Deno.writeTextFile(join(projectRoot, "CONTEXT-MAP.md"), rootMap);
        await Deno.writeTextFile(join(projectRoot, "nested", "CONTEXT.md"), nestedContext);

        const output = await new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", join(REPO_ROOT, "src", "cli.ts"), "plans"],
            cwd: projectRoot,
            env: {
                HOME: homeDir,
                MNEMOTECA_DB_PATH: join(homeDir, "m.db"),
            },
            stdout: "piped",
            stderr: "piped",
        }).output();
        const stdout = new TextDecoder().decode(output.stdout);
        const stderr = new TextDecoder().decode(output.stderr);

        assertEquals(output.code, 0);
        assertStringIncludes(stdout, "context-preservation");
        assertEquals(stderr.includes("domain-language migration"), false);
        assertEquals(stderr.includes("Migrated legacy domain"), false);
        assertEquals(await Deno.readTextFile(join(projectRoot, "CONTEXT.md")), rootContext);
        assertEquals(await Deno.readTextFile(join(projectRoot, "CONTEXT-MAP.md")), rootMap);
        assertEquals(await Deno.readTextFile(join(projectRoot, "nested", "CONTEXT.md")), nestedContext);
        assertEquals(await pathExists(join(projectRoot, "docs", "domain-language.md")), false);
        assertEquals(await pathExists(join(projectRoot, "docs", "domain-language-map.md")), false);
        assertEquals(await pathExists(join(projectRoot, "nested", "domain-language.md")), false);
    } finally {
        await removeTempDir(projectRoot);
        await removeTempDir(homeDir);
    }
});
