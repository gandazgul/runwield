import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { resolveMcpConfig } from "./config.ts";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";

async function git(cwd: string, args: string[]): Promise<void> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "null", stderr: "null" }).output();
    if (output.code !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

async function writeMode(path: string, text: string, mode = 0o600): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true }).catch(() => {});
    await Deno.writeTextFile(path, text, { mode });
    await Deno.chmod(path, mode).catch(() => {});
}

async function makeGitProject(): Promise<string> {
    const root = await Deno.makeTempDir({ prefix: "runwield-mcp-config-" });
    await git(root, ["init"]);
    await Deno.writeTextFile(join(root, ".gitignore"), ".wld/mcp.json\n");
    await git(root, ["add", ".gitignore"]);
    await git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
    return root;
}

Deno.test("MCP config resolves global, project replacement, disable entries, and request additions", async () => {
    await withProcessGlobalTestLock(async () => {
        const oldHome = Deno.env.get("HOME");
        const home = await Deno.makeTempDir({ prefix: "runwield-mcp-home-" });
        const project = await makeGitProject();
        try {
            Deno.env.set("HOME", home);
            await Deno.mkdir(join(home, ".wld"), { recursive: true, mode: 0o700 });
            await Deno.chmod(join(home, ".wld"), 0o700).catch(() => {});
            await writeMode(
                join(home, ".wld", "mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        shared: { command: "global-shared", args: ["a"], env: { TOKEN: "global" } },
                        disabled: { command: "global-disabled", args: [], env: {} },
                        globalOnly: { command: "global-only", args: [], env: {} },
                    },
                }),
            );
            await Deno.mkdir(join(project, ".wld"), { recursive: true });
            await writeMode(
                join(project, ".wld", "mcp.json"),
                JSON.stringify({
                    mcpServers: {
                        shared: { command: "project-shared", args: ["b"], env: { TOKEN: "project" } },
                        disabled: { enabled: false },
                    },
                }),
            );

            const result = await resolveMcpConfig({
                cwd: project,
                requestServers: [{ name: "requestOnly", command: "/bin/echo", args: [], env: {}, source: "request" }],
            });

            assertEquals(result.warnings, []);
            assertEquals(result.servers.map((server) => [server.name, server.command, server.source]), [
                ["shared", "project-shared", "project"],
                ["globalOnly", "global-only", "global"],
                ["requestOnly", "/bin/echo", "request"],
            ]);
        } finally {
            if (oldHome) Deno.env.set("HOME", oldHome);
            else Deno.env.delete("HOME");
            await Deno.remove(home, { recursive: true });
            await Deno.remove(project, { recursive: true });
        }
    });
});

Deno.test("MCP config skips project file that Git can publish", async () => {
    await withProcessGlobalTestLock(async () => {
        const oldHome = Deno.env.get("HOME");
        const home = await Deno.makeTempDir({ prefix: "runwield-mcp-home-" });
        const project = await Deno.makeTempDir({ prefix: "runwield-mcp-unsafe-" });
        try {
            Deno.env.set("HOME", home);
            await git(project, ["init"]);
            await Deno.mkdir(join(home, ".wld"), { recursive: true, mode: 0o700 });
            await writeMode(join(home, ".wld", "mcp.json"), JSON.stringify({ mcpServers: {} }));
            await Deno.mkdir(join(project, ".wld"), { recursive: true });
            await writeMode(
                join(project, ".wld", "mcp.json"),
                JSON.stringify({
                    mcpServers: { unsafe: { command: "unsafe", args: [], env: {} } },
                }),
            );

            const result = await resolveMcpConfig({ cwd: project });
            assertEquals(result.servers, []);
            assertEquals(result.warnings.length, 1);
            assertStringIncludes(result.warnings[0].message, "ignored by Git");
        } finally {
            if (oldHome) Deno.env.set("HOME", oldHome);
            else Deno.env.delete("HOME");
            await Deno.remove(home, { recursive: true });
            await Deno.remove(project, { recursive: true });
        }
    });
});
