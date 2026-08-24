import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const repoRoot = new URL("..", import.meta.url).pathname;

async function run(cwd: string, command: string, args: string[]) {
    const result = await new Deno.Command(command, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
        code: result.code,
        stdout: decoder.decode(result.stdout),
        stderr: decoder.decode(result.stderr),
    };
}

Deno.test("pre-commit re-stages an intentionally tracked file below an ignore rule", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-pre-commit-" });
    try {
        assertEquals((await run(projectRoot, "git", ["init", "--quiet"])).code, 0);
        await Deno.mkdir(join(projectRoot, ".generated"));
        await Deno.writeTextFile(join(projectRoot, ".gitignore"), ".generated/\n");
        await Deno.writeTextFile(join(projectRoot, ".generated", "types.ts"), "export const value={ready:true}\n");
        assertEquals((await run(projectRoot, "git", ["add", ".gitignore"])).code, 0);
        assertEquals((await run(projectRoot, "git", ["add", "-f", ".generated/types.ts"])).code, 0);

        const hook = join(repoRoot, ".githooks", "pre-commit");
        const result = await run(projectRoot, "/bin/sh", [hook]);

        assertEquals(result.code, 0, `${result.stdout}${result.stderr}`);
        const staged = await run(projectRoot, "git", ["diff", "--cached", "--", ".generated/types.ts"]);
        assertEquals(staged.code, 0);
        assertStringIncludes(staged.stdout, "export const value = { ready: true };");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
