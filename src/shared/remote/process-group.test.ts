import { assert, assertEquals } from "@std/assert";
import { terminateOwnedLinuxGroup } from "../foreground-process.ts";

const linux = Deno.build.os === "linux";

async function running(pid: number): Promise<boolean> {
    try {
        const stat = await Deno.readTextFile(`/proc/${pid}/stat`);
        const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
        return state !== "Z" && state !== "X";
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function groupFixture(ignoreTerm: boolean) {
    const directory = await Deno.makeTempDir();
    const pidFile = `${directory}/descendant`;
    const script = `${ignoreTerm ? 'trap "" TERM; ' : ""}sleep 30 & echo $! > "$1"; wait`;
    const child = new Deno.Command("sh", {
        args: ["-c", script, "sh", pidFile],
        stdin: "null",
        stdout: "null",
        stderr: "null",
        detached: true,
    }).spawn();
    let descendant = 0;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        descendant = Number(await Deno.readTextFile(pidFile).catch(() => ""));
        if (descendant && await running(descendant)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!descendant) throw new Error("Child did not start a descendant");
    return { child, descendant, directory };
}

Deno.test({
    name: "remote-owned process cleanup confirms child and grandchild exit without stopping an unrelated process",
    ignore: !linux,
    fn: async () => {
        const { child, descendant, directory } = await groupFixture(false);
        const unrelated = new Deno.Command("sleep", { args: ["30"], stdout: "null", stderr: "null" }).spawn();
        try {
            assertEquals(await terminateOwnedLinuxGroup(child), true);
            assertEquals(await running(child.pid), false);
            assertEquals(await running(descendant), false);
            assert(await running(unrelated.pid));
        } finally {
            if (await running(child.pid)) child.kill("SIGKILL");
            if (await running(descendant)) Deno.kill(descendant, "SIGKILL");
            if (await running(unrelated.pid)) unrelated.kill("SIGKILL");
            await Promise.all([child.status, unrelated.status]);
            await Deno.remove(directory, { recursive: true });
        }
    },
});

Deno.test({
    name: "remote-owned process cleanup forces a blocked child and grandchild after the graceful deadline",
    ignore: !linux,
    fn: async () => {
        const { child, descendant, directory } = await groupFixture(true);
        try {
            const started = Date.now();
            assertEquals(await terminateOwnedLinuxGroup(child, 200), true);
            assert(Date.now() - started >= 200);
            assertEquals(await running(descendant), false);
        } finally {
            if (await running(child.pid)) child.kill("SIGKILL");
            if (await running(descendant)) Deno.kill(descendant, "SIGKILL");
            await child.status;
            await Deno.remove(directory, { recursive: true });
        }
    },
});
