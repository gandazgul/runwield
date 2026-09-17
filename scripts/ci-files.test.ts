import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listCiFiles } from "./ci-files.ts";

Deno.test("CI file discovery includes source work but excludes Git-ignored and .wld files", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-ci-files-" });
    try {
        const init = await new Deno.Command("git", {
            args: ["init", "-q"],
            cwd: root,
            stderr: "piped",
        }).output();
        assertEquals(init.code, 0, new TextDecoder().decode(init.stderr));

        await Deno.mkdir(join(root, "ignored"));
        await Deno.mkdir(join(root, ".wld"));
        await Deno.writeTextFile(join(root, ".gitignore"), "ignored/\n");
        await Deno.writeTextFile(join(root, "tracked.ts"), "export const tracked = true;\n");
        await Deno.writeTextFile(join(root, "visible.ts"), "export const visible = true;\n");
        await Deno.writeTextFile(join(root, "ignored", "temp.test.ts"), 'throw new Error("must not run");\n');
        await Deno.writeTextFile(join(root, ".wld", "temp.test.ts"), 'throw new Error("must not run");\n');

        const add = await new Deno.Command("git", {
            args: ["add", ".gitignore", "tracked.ts"],
            cwd: root,
            stderr: "piped",
        }).output();
        assertEquals(add.code, 0, new TextDecoder().decode(add.stderr));

        const files = await listCiFiles(root);
        assertEquals(files.includes("tracked.ts"), true);
        assertEquals(files.includes("visible.ts"), true);
        assertEquals(files.includes("ignored/temp.test.ts"), false);
        assertEquals(files.includes(".wld/temp.test.ts"), false);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
