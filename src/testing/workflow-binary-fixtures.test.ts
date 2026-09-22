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
