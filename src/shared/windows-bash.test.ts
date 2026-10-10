import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.ts";
import { findWindowsBashPath } from "./windows-bash.ts";

Deno.test("Windows Bash discovery finds per-user and custom Git installs without Bash on PATH", async () => {
    await withProcessGlobalTestLock(async () => {
        const keys = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "PATH"];
        const previous = keys.map((key) => Deno.env.get(key));
        const root = await Deno.makeTempDir({ prefix: "rw-windows-bash-" });
        const install = async (path: string) => {
            await Deno.mkdir(dirname(path), { recursive: true });
            await Deno.writeTextFile(path, "fixture executable");
        };
        try {
            for (const key of keys) Deno.env.delete(key);
            assertEquals(findWindowsBashPath(), undefined);
            const local = join(root, "User Profile", "AppData", "Local");
            Deno.env.set("LOCALAPPDATA", local);
            const userBash = join(local, "Programs", "Git", "bin", "bash.exe");
            await install(userBash);
            assertEquals(findWindowsBashPath(), userBash);

            const system = join(root, "Program Files");
            Deno.env.set("ProgramFiles", system);
            const systemBash = join(system, "Git", "bin", "bash.exe");
            await install(systemBash);
            assertEquals(findWindowsBashPath(), systemBash);
            await Deno.remove(systemBash);
            await Deno.remove(userBash);

            const custom = join(root, "Custom Git");
            await install(join(custom, "cmd", "git.exe"));
            const customBash = join(custom, "bin", "bash.exe");
            await install(customBash);
            Deno.env.set("PATH", `;"${join(custom, "cmd")}";;`);
            assertEquals(findWindowsBashPath(), customBash);
            await Deno.remove(customBash);
            const portableBash = join(custom, "usr", "bin", "bash.exe");
            await install(portableBash);
            assertEquals(findWindowsBashPath(), portableBash);

            const standalone = join(root, "MSYS2", "bin");
            const standaloneBash = join(standalone, "bash.exe");
            await install(standaloneBash);
            Deno.env.set("PATH", `${join(root, "missing")};${standalone}`);
            assertEquals(findWindowsBashPath(), standaloneBash);
            await Deno.remove(standaloneBash);
            await Deno.mkdir(standaloneBash);
            assertEquals(findWindowsBashPath(), undefined);
        } finally {
            keys.forEach((key, index) => {
                const value = previous[index];
                if (value === undefined) Deno.env.delete(key);
                else Deno.env.set(key, value);
            });
            await Deno.remove(root, { recursive: true });
        }
    });
});
