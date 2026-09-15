import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { git } from "../git-test-fixture.ts";
import { finalizeMergeRepair } from "./validation-merge-repair.ts";

async function makeRepairRepo(): Promise<string> {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-merge-repair-" });
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.email", "runwield@example.com"]);
    await git(cwd, ["config", "user.name", "RunWield Test"]);
    await Deno.writeTextFile(join(cwd, "README.md"), "base\n");
    await git(cwd, ["add", "README.md"]);
    await git(cwd, ["commit", "-m", "base"]);
    return cwd;
}

Deno.test("merge repair finalization does not stage untracked runtime state", async () => {
    const cwd = await makeRepairRepo();
    try {
        await git(cwd, ["checkout", "-b", "execution"]);
        await Deno.writeTextFile(join(cwd, "feature.txt"), "execution\n");
        await git(cwd, ["add", "feature.txt"]);
        await git(cwd, ["commit", "-m", "execution work"]);
        await git(cwd, ["checkout", "main"]);
        await Deno.writeTextFile(join(cwd, "target.txt"), "target\n");
        await git(cwd, ["add", "target.txt"]);
        await git(cwd, ["commit", "-m", "target work"]);
        await git(cwd, ["merge", "--no-ff", "execution"]);
        await Deno.writeTextFile(join(cwd, "repair-note.txt"), "manual repair\n");
        await Deno.mkdir(join(cwd, ".wld", "internal", "repair"), { recursive: true });
        await Deno.writeTextFile(join(cwd, ".wld", "internal", "repair", "state.json"), "runtime\n");

        assertEquals(await finalizeMergeRepair(cwd), true);

        const paths = await git(cwd, ["ls-tree", "-r", "--name-only", "HEAD"]);
        assertEquals(paths.includes("repair-note.txt"), true);
        assertEquals(paths.includes(".wld/internal/repair/state.json"), false);
        assertEquals(await Deno.readTextFile(join(cwd, ".wld", "internal", "repair", "state.json")), "runtime\n");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
