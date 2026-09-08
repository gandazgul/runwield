import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../../../../testing/process-global-lock.js";
import { HostedSession } from "../../hosted-session.js";
import {
    AGY_MCP_ARGS,
    AGY_MCP_PERMISSION,
    ensureAgyCliMcpSetup,
    inspectAgyCliMcpSetup,
    installAgyCliMcpSetup,
    resolveInstalledWldExecutable,
} from "./mcp-setup.ts";

async function withSetupHome(callback: (home: string, binDir: string) => Promise<void>): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const priorHome = Deno.env.get("HOME");
        const priorPath = Deno.env.get("PATH");
        const home = await Deno.makeTempDir({ prefix: "runwield-agy-mcp-setup-" });
        const binDir = join(home, "bin");
        try {
            await Deno.mkdir(binDir, { recursive: true });
            const wldPath = join(binDir, "wld");
            await Deno.writeFile(wldPath, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00]));
            await Deno.chmod(wldPath, 0o755);
            Deno.env.set("HOME", home);
            Deno.env.set("PATH", `${binDir}:${priorPath || ""}`);
            await callback(home, binDir);
        } finally {
            if (priorHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", priorHome);
            if (priorPath === undefined) Deno.env.delete("PATH");
            else Deno.env.set("PATH", priorPath);
            await Deno.remove(home, { recursive: true }).catch(() => undefined);
        }
    });
}

async function readJson(path: string) {
    return JSON.parse(await Deno.readTextFile(path));
}

Deno.test("Agy MCP setup installs the exact stable server and preserves unrelated settings", async () => {
    await withSetupHome(async (home, binDir) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");
        await Deno.mkdir(join(home, ".gemini", "config"), { recursive: true });
        await Deno.mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true });
        await Deno.writeTextFile(
            configPath,
            JSON.stringify({ mcpServers: { other: { command: "other", args: ["x"] } }, keep: true }),
        );
        await Deno.writeTextFile(
            settingsPath,
            JSON.stringify({ permissions: { allow: ["shell(ls)"] }, theme: "dark" }),
        );

        await installAgyCliMcpSetup();

        const config = await readJson(configPath);
        assertEquals(config.keep, true);
        assertEquals(config.mcpServers.other.command, "other");
        assertEquals(config.mcpServers.runwield.command, await Deno.realPath(join(binDir, "wld")));
        assertEquals(config.mcpServers.runwield.args, [...AGY_MCP_ARGS]);
        assertEquals(config.mcpServers.runwield.env, undefined);
        assertEquals(config.mcpServers.runwield.url, undefined);
        const settings = await readJson(settingsPath);
        assertEquals(settings.theme, "dark");
        assertEquals(settings.permissions.allow.includes("shell(ls)"), true);
        assertEquals(settings.permissions.allow.includes(AGY_MCP_PERMISSION), true);
        assertEquals((await inspectAgyCliMcpSetup()).ok, true);
    });
});

Deno.test("Agy MCP setup repairs persistent turn data on the runwield server entry", async () => {
    await withSetupHome(async (home, binDir) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");
        await Deno.mkdir(join(home, ".gemini", "config"), { recursive: true });
        await Deno.mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true });
        const command = await Deno.realPath(join(binDir, "wld"));
        await Deno.writeTextFile(
            configPath,
            JSON.stringify({
                mcpServers: {
                    runwield: {
                        command,
                        args: [...AGY_MCP_ARGS],
                        token: "secret",
                        sessionId: "turn-session",
                        headers: { authorization: "Bearer secret" },
                    },
                },
            }),
        );
        await Deno.writeTextFile(
            settingsPath,
            JSON.stringify({ permissions: { allow: [AGY_MCP_PERMISSION] } }),
        );

        assertEquals((await inspectAgyCliMcpSetup()).ok, false);
        await installAgyCliMcpSetup();

        const server = (await readJson(configPath)).mcpServers.runwield;
        assertEquals(server, { command, args: [...AGY_MCP_ARGS] });
        assertEquals((await inspectAgyCliMcpSetup()).ok, true);
    });
});

Deno.test("Agy MCP setup refuses foreign runwield servers and contradictory permissions", async () => {
    await withSetupHome(async (home) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");
        await Deno.mkdir(join(home, ".gemini", "config"), { recursive: true });
        await Deno.mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true });
        await Deno.writeTextFile(configPath, JSON.stringify({ mcpServers: { runwield: { command: "/tmp/other" } } }));
        await Deno.writeTextFile(settingsPath, JSON.stringify({ permissions: { allow: [] } }));
        await assertRejects(() => installAgyCliMcpSetup(), Error, "mcpServers.runwield");

        await Deno.writeTextFile(configPath, JSON.stringify({ mcpServers: {} }));
        await Deno.writeTextFile(settingsPath, JSON.stringify({ permissions: { deny: [AGY_MCP_PERMISSION] } }));
        const error = await assertRejects(() => installAgyCliMcpSetup(), Error, "Ask or Deny");
        assertStringIncludes(error.message, settingsPath);
        assertStringIncludes(error.message, AGY_MCP_PERMISSION);
    });
});

Deno.test("Agy MCP setup refuses non-interactive first use without mutating files", async () => {
    await withSetupHome(async (home) => {
        const { ensureAgyCliMcpSetup } = await import("./mcp-setup.ts");
        await assertRejects(() => ensureAgyCliMcpSetup(), Error, "needs approval");
        const status = await inspectAgyCliMcpSetup();
        assertEquals(status.ok, false);
        assertStringIncludes(status.message, "needs approval");
        await assertRejects(() => Deno.stat(join(home, ".gemini", "config", "mcp_config.json")), Deno.errors.NotFound);
    });
});

Deno.test("Agy MCP setup asks once, accepts explicit approval, and preserves files on decline", async () => {
    await withSetupHome(async (home) => {
        const declined = new HostedSession({ id: "agy-mcp-declined", cwd: home });
        declined.setInteractionAdapter({
            requestInteraction: () => ({ outcome: "accepted", value: "decline" }),
            supportsInteraction: () => true,
        });
        await assertRejects(() => ensureAgyCliMcpSetup({ hostedSession: declined }), Error, "not approved");
        await assertRejects(() => Deno.stat(join(home, ".gemini", "config", "mcp_config.json")), Deno.errors.NotFound);

        const approved = new HostedSession({ id: "agy-mcp-approved", cwd: home });
        approved.setInteractionAdapter({
            requestInteraction: (request) => {
                assertStringIncludes(request.prompt, ".gemini/config/mcp_config.json");
                assertStringIncludes(request.prompt, ".gemini/antigravity-cli/settings.json");
                assertStringIncludes(request.prompt, "wld mcp agy-cli");
                assertStringIncludes(request.prompt, AGY_MCP_PERMISSION);
                assertStringIncludes(request.prompt, "persists");
                return { outcome: "accepted", value: "approve" };
            },
            supportsInteraction: () => true,
        });
        await ensureAgyCliMcpSetup({ hostedSession: approved });
        assertEquals((await inspectAgyCliMcpSetup()).ok, true);
    });
});

Deno.test("Agy MCP setup rejects malformed files and symbolic links", async () => {
    await withSetupHome(async (home) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");
        await Deno.mkdir(join(home, ".gemini", "config"), { recursive: true });
        await Deno.mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true });

        await Deno.writeTextFile(configPath, "[]");
        await Deno.writeTextFile(settingsPath, JSON.stringify({ permissions: { allow: [] } }));
        await assertRejects(() => installAgyCliMcpSetup(), Error, "must contain a JSON object");

        await Deno.writeTextFile(configPath, JSON.stringify({ mcpServers: {} }));
        await Deno.remove(settingsPath);
        await Deno.symlink(configPath, settingsPath);
        await assertRejects(() => installAgyCliMcpSetup(), Error, "must not be a symbolic link");
    });
});

Deno.test("Agy MCP setup refuses malformed permission structures", async () => {
    await withSetupHome(async (home) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");
        await Deno.mkdir(join(home, ".gemini", "config"), { recursive: true });
        await Deno.mkdir(join(home, ".gemini", "antigravity-cli"), { recursive: true });
        await Deno.writeTextFile(configPath, JSON.stringify({ mcpServers: {} }));

        await Deno.writeTextFile(settingsPath, JSON.stringify({ permissions: "keep-me" }));
        await assertRejects(() => installAgyCliMcpSetup(), Error, "permissions must be a JSON object");
        assertEquals((await readJson(settingsPath)).permissions, "keep-me");

        await Deno.writeTextFile(settingsPath, JSON.stringify({ permissions: { allow: "keep-me" } }));
        await assertRejects(() => installAgyCliMcpSetup(), Error, "permissions.allow must be a JSON array");
        assertEquals((await readJson(settingsPath)).permissions.allow, "keep-me");
    });
});

Deno.test("Agy MCP setup refuses source-run wld commands", async () => {
    await withSetupHome(async (_home, binDir) => {
        Deno.env.set("PATH", binDir);
        const wldPath = join(binDir, "wld");
        await Deno.writeTextFile(wldPath, '#!/bin/sh\nexec deno run -A src/cli.ts "$@"\n');
        await Deno.chmod(wldPath, 0o755);
        await assertRejects(() => resolveInstalledWldExecutable(), Error, "standalone wld executable");
    });
});

Deno.test("Agy MCP setup refuses non-executable wld commands", async () => {
    await withSetupHome(async (_home, binDir) => {
        Deno.env.set("PATH", binDir);
        const wldPath = join(binDir, "wld");
        await Deno.chmod(wldPath, 0o644);
        await assertRejects(() => resolveInstalledWldExecutable(), Error, "standalone wld executable");
    });
});

Deno.test("Agy MCP setup is idempotent and concurrent installers converge", async () => {
    await withSetupHome(async (home) => {
        const configPath = join(home, ".gemini", "config", "mcp_config.json");
        const settingsPath = join(home, ".gemini", "antigravity-cli", "settings.json");

        await Promise.all([installAgyCliMcpSetup(), installAgyCliMcpSetup()]);
        const firstConfig = await Deno.readTextFile(configPath);
        const firstSettings = await Deno.readTextFile(settingsPath);
        await installAgyCliMcpSetup();

        assertEquals(await Deno.readTextFile(configPath), firstConfig);
        assertEquals(await Deno.readTextFile(settingsPath), firstSettings);
        const config = await readJson(configPath);
        const settings = await readJson(settingsPath);
        assertEquals(Object.keys(config.mcpServers).sort(), ["runwield"]);
        assertEquals(settings.permissions.allow.filter((item: string) => item === AGY_MCP_PERMISSION).length, 1);
    });
});
