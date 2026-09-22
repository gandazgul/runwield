import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createClipboardReader } from "../ui/tui/clipboard.ts";
import { assertWorkflowBinaryCallsSupported, writeWorkflowBinaryFixtures } from "./workflow-binary-fixtures.ts";

Deno.test("workflow binary fixtures execute supported external commands and preserve Git", async () => {
    const root = await Deno.makeTempDir({ prefix: "workflow-binaries-quote'-" });
    try {
        const bin = await writeWorkflowBinaryFixtures(root);
        const run = (name: string, args: string[]) =>
            new Deno.Command(join(bin, name), { args, stdout: "piped", stderr: "piped" }).output();
        for (const name of ["mnemoteca", "cymbal", "ketch"]) {
            assertEquals((await run(name, ["--help"])).success, true);
        }
        assertEquals((await run("cymbal", ["index", "."])).success, true);
        assertEquals(
            (await run("cymbal", ["--no-federate", "hook", "nudge", "--format=text", "--", "git diff"])).success,
            true,
        );
        const help = await run("mnemoteca", ["update", "--help"]);
        assertStringIncludes(new TextDecoder().decode(help.stdout), "update <id> --replace-tags");
        assertEquals(
            new TextDecoder().decode((await run("mnemoteca", ["list", "-t", "core", "-f", "plain"])).stdout).trim(),
            "No documents",
        );
        assertEquals(JSON.parse(new TextDecoder().decode((await run("mnemoteca", ["search", "query"])).stdout)), {
            results: [],
        });
        const backup = join(root, "nested backup", "export.jsonl");
        assertEquals((await run("mnemoteca", ["export", "--output", backup])).success, true);
        assertEquals(JSON.parse(await Deno.readTextFile(backup)), { type: "mnemoteca-export" });
        const clipboard = createClipboardReader({
            os: "darwin",
            runCommand: (name, args) => run(name, args),
            makeTempFile: (options) => Deno.makeTempFile(options),
            remove: (path) => Deno.remove(path),
        });
        assertEquals(await clipboard.hasClipboardImage(), false);
        assertEquals(await clipboard.readClipboardImage(), null);
        await assertWorkflowBinaryCallsSupported(root);
        await assertRejects(() => Deno.stat(join(bin, "git")), Deno.errors.NotFound);
        await assertRejects(() => Deno.stat(join(bin, "snip")), Deno.errors.NotFound);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("unsupported binary calls fail even when the caller swallows the exit code", async () => {
    const root = await Deno.makeTempDir({ prefix: "workflow-binaries-reject-" });
    try {
        const bin = await writeWorkflowBinaryFixtures(root);
        for (const name of ["mnemoteca", "cymbal", "ketch", "osascript"]) {
            const output = await new Deno.Command(join(bin, name), {
                args: ["unexpected-operation"],
                stdout: "piped",
                stderr: "piped",
            }).output();
            assertEquals(output.code, 64);
            assertStringIncludes(new TextDecoder().decode(output.stderr), `Unsupported ${name}`);
        }
        const error = await assertRejects(() => assertWorkflowBinaryCallsSupported(root), Error);
        for (const name of ["mnemoteca", "cymbal", "ketch", "osascript"]) {
            assertStringIncludes(error.message, `Unsupported ${name}`);
        }
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("shared executable contents keep command logs and failures isolated", async () => {
    const root = await Deno.makeTempDir({ prefix: "workflow-binaries-isolation'-" });
    const first = join(root, "first");
    const second = join(root, "second");
    try {
        const [firstBin, secondBin] = await Promise.all([
            writeWorkflowBinaryFixtures(first),
            writeWorkflowBinaryFixtures(second),
        ]);
        if (Deno.build.os !== "windows") {
            assertEquals(
                await Deno.realPath(join(firstBin, "mnemoteca")),
                await Deno.realPath(join(secondBin, "cymbal")),
            );
        }
        const run = (bin: string, name: string, args: string[]) =>
            new Deno.Command(name, {
                args,
                env: { PATH: `${bin}:${Deno.env.get("PATH") || ""}` },
                stdout: "piped",
                stderr: "piped",
            }).output();
        const results = await Promise.all([
            run(firstBin, "mnemoteca", ["unexpected-operation"]),
            run(secondBin, "cymbal", ["index", "."]),
        ]);
        assertEquals(results.map((result) => result.code), [64, 0]);
        await assertRejects(() => assertWorkflowBinaryCallsSupported(first), Error, "Unsupported mnemoteca");
        await assertWorkflowBinaryCallsSupported(second);
        assertEquals(await Deno.readTextFile(join(firstBin, "calls.log")), "mnemoteca\nunexpected-operation\n");
        assertEquals(await Deno.readTextFile(join(secondBin, "calls.log")), "cymbal\nindex\n.\n");
        await Deno.remove(first, { recursive: true });
        assertEquals((await run(secondBin, "mnemoteca", ["--help"])).code, 0);
        await assertWorkflowBinaryCallsSupported(second);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("GitHub unavailability is opt-in and preserves supported-call checks", async () => {
    const root = await Deno.makeTempDir({ prefix: "workflow-github-fixture-" });
    try {
        const ordinary = await writeWorkflowBinaryFixtures(join(root, "ordinary"));
        await assertRejects(() => Deno.stat(join(ordinary, "gh")), Deno.errors.NotFound);
        const goldenRoot = join(root, "golden");
        const golden = await writeWorkflowBinaryFixtures(goldenRoot, { githubUnavailable: true });
        const output = await new Deno.Command(join(golden, "gh"), {
            args: ["auth", "status"],
            stdout: "piped",
            stderr: "piped",
        }).output();
        assertEquals(output.code, 1);
        assertStringIncludes(new TextDecoder().decode(output.stderr), "golden fixture: gh unavailable");
        assertEquals(await Deno.readTextFile(join(golden, "calls.log")), "gh\nauth\nstatus\n");
        await assertWorkflowBinaryCallsSupported(goldenRoot);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
