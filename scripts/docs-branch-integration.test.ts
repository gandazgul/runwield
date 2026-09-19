import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import { PUBLIC_DOCS, stagePublicDocs } from "./public-docs.ts";

const reconcileScript = resolve("scripts/reconcile-docs-branch.sh");

async function run(cwd: string, ...args: string[]): Promise<string> {
    const output = await new Deno.Command(args[0], {
        args: args.slice(1),
        cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!output.success) throw new Error(`${stdout}\n${stderr}`);
    return stdout.trim();
}

async function write(path: string, content: string): Promise<void> {
    await Deno.mkdir(resolve(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, content);
}

Deno.test("docs branch publishes Stable content, preserves corrections, and stops on conflicts", async () => {
    const root = await Deno.makeTempDir();
    const remote = join(root, "remote.git");
    const work = join(root, "work");
    try {
        await run(root, "git", "init", "--bare", remote);
        await run(root, "git", "clone", remote, work);
        await run(work, "git", "config", "user.name", "Test");
        await run(work, "git", "config", "user.email", "test@example.com");
        await run(work, "git", "checkout", "-b", "main");

        for (const path of PUBLIC_DOCS) {
            await write(join(work, "docs", path), `# ${path}\n\nSTABLE-A ${path}\n`);
        }
        for (
            const path of [
                ".github/workflows/docs.yml",
                ".gitignore",
                "deno.json",
                "deno.lock",
                "scripts/public-docs.ts",
                "scripts/check-public-docs.ts",
                "scripts/public-docs.test.ts",
                "scripts/docs-workflow.test.ts",
                "scripts/reconcile-docs-branch.sh",
            ]
        ) {
            const content = path === ".gitignore"
                ? "# fixture\n"
                : path === "deno.json"
                ? '{"lock":false}\n'
                : path === "deno.lock"
                ? "{}\n"
                : `${path}\n`;
            await write(join(work, path), content);
        }
        await write(join(work, "src", "product.ts"), "export const product = 'STABLE-A';\n");
        await write(
            join(work, "docs-site", "release.json"),
            '{"version":"preview","sourceRef":"main","releaseUrl":"https://example.test"}\n',
        );
        await write(join(work, "docs-site", "marker.txt"), "site support\n");
        await run(work, "git", "add", ".");
        await run(work, "git", "commit", "-m", "Stable A");
        await run(work, "git", "tag", "v1.0.0");
        await run(work, "git", "push", "origin", "main", "--tags");

        await write(join(work, "docs", "quickstart.md"), "# Quickstart\n\nUNRELEASED-B\n");
        await write(join(work, "docs", "index.md"), "# Public home\n\nClean home\n");
        await write(join(work, "src", "product.ts"), "export const product = 'UNRELEASED-B';\n");
        await run(work, "git", "add", ".");
        await run(work, "git", "commit", "-m", "Unreleased B and site support");
        const sourceSha = await run(work, "git", "rev-parse", "HEAD");

        await run(work, "bash", reconcileScript, "v1.0.0", "true", sourceSha);
        assertStringIncludes(await Deno.readTextFile(join(work, "docs", "quickstart.md")), "STABLE-A");
        assertEquals((await Deno.readTextFile(join(work, "docs", "quickstart.md"))).includes("UNRELEASED-B"), false);
        assertStringIncludes(await Deno.readTextFile(join(work, "docs", "index.md")), "Clean home");
        assertStringIncludes(await Deno.readTextFile(join(work, "src", "product.ts")), "STABLE-A");
        assertEquals(JSON.parse(await Deno.readTextFile(join(work, "docs-site", "release.json"))).version, "v1.0.0");
        await run(work, "git", "merge-base", "--is-ancestor", "v1.0.0", "HEAD");
        await stagePublicDocs(work, join(work, "generated"));
        assertStringIncludes(await Deno.readTextFile(join(work, "generated", "quickstart.md")), "STABLE-A");

        await write(join(work, "docs", "contributing.md"), "# Contributing\n\nDOCS-CORRECTION\n");
        await run(work, "git", "add", "docs/contributing.md");
        await run(work, "git", "commit", "-m", "Correct docs");
        await run(work, "git", "push", "origin", "HEAD:docs/stable");

        await run(work, "git", "checkout", "main");
        await write(join(work, "docs", "quickstart.md"), "# Quickstart\n\nSTABLE-B\n");
        await run(work, "git", "add", "docs/quickstart.md");
        await run(work, "git", "commit", "-m", "Stable B");
        await run(work, "git", "tag", "v1.0.1");
        await run(work, "git", "push", "origin", "main", "--tags");
        const stableBSha = await run(work, "git", "rev-parse", "HEAD");
        await run(work, "bash", reconcileScript, "v1.0.1", "false", stableBSha);
        assertStringIncludes(await Deno.readTextFile(join(work, "docs", "quickstart.md")), "STABLE-B");
        assertStringIncludes(await Deno.readTextFile(join(work, "docs", "contributing.md")), "DOCS-CORRECTION");
        assertStringIncludes(await Deno.readTextFile(join(work, "src", "product.ts")), "UNRELEASED-B");
        assertEquals(JSON.parse(await Deno.readTextFile(join(work, "docs-site", "release.json"))).version, "v1.0.1");

        await write(join(work, "docs", "quickstart.md"), "# Quickstart\n\nDOCS-CONFLICT\n");
        await run(work, "git", "add", "docs/quickstart.md");
        await run(work, "git", "commit", "-m", "Conflicting docs correction");
        await run(work, "git", "push", "origin", "HEAD:docs/stable");
        const beforeConflict = await run(work, "git", "rev-parse", "HEAD");

        await run(work, "git", "checkout", "main");
        await write(join(work, "docs", "quickstart.md"), "# Quickstart\n\nSTABLE-C-CONFLICT\n");
        await run(work, "git", "add", "docs/quickstart.md");
        await run(work, "git", "commit", "-m", "Stable C");
        await run(work, "git", "tag", "v1.0.2");
        await run(work, "git", "push", "origin", "main", "--tags");
        const stableCSha = await run(work, "git", "rev-parse", "HEAD");
        await assertRejects(
            () => run(work, "bash", reconcileScript, "v1.0.2", "false", stableCSha),
            Error,
            "CONFLICT",
        );
        assertEquals(
            await run(work, "git", "ls-remote", "origin", "refs/heads/docs/stable"),
            `${beforeConflict}\trefs/heads/docs/stable`,
        );
        assertEquals((await run(work, "git", "tag", "--list", "v1.*")).split("\n").length, 3);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
