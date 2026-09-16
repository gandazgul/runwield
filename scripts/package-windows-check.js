/**
 * Native Windows package smoke checks for a built RunWield ZIP.
 */

import { basename, join } from "@std/path";
import { makeManagedSessionFixture } from "../src/testing/managed-session-fixture.ts";

function usage() {
    return "Usage: package-windows-check.js --package <wld-*-windows-x64.zip>";
}

/** @param {string[]} args */
function parseArgs(args) {
    const options = { packagePath: "" };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--package") options.packagePath = args[++index] || "";
        else throw new Error(`Unknown package:windows:check option: ${arg}\n${usage()}`);
    }
    if (!options.packagePath) throw new Error(usage());
    return options;
}

/** @param {string} command @param {string[]} args @param {{ cwd?: string, env?: Record<string, string>, stdin?: string }} [options] */
async function run(command, args, options = {}) {
    const child = new Deno.Command(command, {
        args,
        cwd: options.cwd,
        env: options.env,
        stdin: options.stdin === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    if (options.stdin !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(options.stdin));
        await writer.close();
    }
    const result = await child.output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(result.stdout);
    const stderr = decoder.decode(result.stderr);
    if (!result.success) throw new Error(`${command} ${args.join(" ")} failed\n${stdout}${stderr}`);
    return { stdout, stderr };
}

/** @param {string} path */
async function assertFile(path) {
    const stat = await Deno.stat(path).catch(() => null);
    if (!stat?.isFile) throw new Error(`Package check missing file: ${path}`);
}

/**
 * @param {string} exe
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>[]} messages
 * @returns {Promise<Record<string, any>[]>}
 */
async function runAcpExchange(exe, env, messages) {
    const child = new Deno.Command(exe, {
        args: ["--mode", "acp"],
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    const encoder = new TextEncoder();
    await writer.write(
        encoder.encode(
            JSON.stringify({
                jsonrpc: "2.0",
                id: "initialize",
                method: "initialize",
                params: { protocolVersion: 1, clientCapabilities: { _meta: { "terminal-auth": true } } },
            }) + "\n",
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    for (const message of messages) await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await writer.close();
    const timeout = setTimeout(() => {
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
    }, 10_000);
    try {
        const output = await child.output();
        const decoder = new TextDecoder();
        const stdout = decoder.decode(output.stdout);
        const stderr = decoder.decode(output.stderr);
        if (output.code !== 0) throw new Error(`ACP protocol exchange exited with ${output.code}.\n${stdout}${stderr}`);
        return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } finally {
        clearTimeout(timeout);
    }
}

/** @param {string} exe @param {Record<string, string>} env */
async function checkAcpProtocolExchange(exe, env) {
    const child = new Deno.Command(exe, {
        args: ["--mode", "acp"],
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    const encoder = new TextEncoder();
    await writer.write(
        encoder.encode(
            JSON.stringify({
                jsonrpc: "2.0",
                id: "initialize",
                method: "initialize",
                params: { protocolVersion: 1, clientCapabilities: { _meta: { "terminal-auth": true } } },
            }) + "\n",
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await writer.write(
        encoder.encode(
            JSON.stringify({
                jsonrpc: "2.0",
                id: "session-new",
                method: "session/new",
                params: { cwd: env.LOCALAPPDATA, mcpServers: [] },
            }) + "\n",
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await writer.close();
    const timeout = setTimeout(() => {
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
    }, 10_000);
    try {
        const output = await child.output();
        const decoder = new TextDecoder();
        const stdout = decoder.decode(output.stdout);
        const stderr = decoder.decode(output.stderr);
        if (output.code !== 0) throw new Error(`ACP protocol exchange exited with ${output.code}.`);
        const messages = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
        const initialized = messages.find((message) => message.id === "initialize");
        if (initialized?.result?.protocolVersion !== 1 || initialized?.result?.agentInfo?.name !== "RunWield") {
            throw new Error(`ACP initialize response was incomplete:\n${stdout}${stderr}`);
        }
        const authMethods = Array.isArray(initialized.result.authMethods) ? initialized.result.authMethods : [];
        let hasTerminalLogin = false;
        for (const method of authMethods) {
            if (method.name === "RunWield Login") hasTerminalLogin = true;
        }
        if (!hasTerminalLogin) {
            throw new Error(
                `ACP initialize did not advertise terminal login for a terminal-auth client:\n${stdout}${stderr}`,
            );
        }
        const sessionNew = messages.find((message) => message.id === "session-new");
        const persistedSessionId = sessionNew?.result?._meta?.runwield?.persistedSessionId;
        const acpSessionId = sessionNew?.result?.sessionId;
        if (!acpSessionId || !persistedSessionId) {
            throw new Error(`ACP session/new did not create a persisted Session:\n${stdout}${stderr}`);
        }

        const loaded = await runAcpExchange(exe, env, [
            {
                jsonrpc: "2.0",
                id: "load-saved-session",
                method: "session/load",
                params: { cwd: env.LOCALAPPDATA, sessionId: persistedSessionId, mcpServers: [] },
            },
        ]);
        const loadedSession = loaded.find((message) => message.id === "load-saved-session");
        if (loadedSession?.result?._meta?.runwield?.persistedSessionId !== persistedSessionId) {
            throw new Error(`ACP session/load did not resume the saved Session:\n${JSON.stringify(loaded)}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

/** @param {string} exe @param {Record<string, string>} env */
async function checkCoreHelperFlows(exe, env) {
    await run(exe, ["package-smoke", "core-flows"], { env: { ...env, WLD_INTERNAL_PACKAGE_CHECK: "1" } });
}

/** @param {string} exe @param {Record<string, string>} env */
async function checkProviderSetupLaunch(exe, env) {
    const child = new Deno.Command(exe, {
        args: ["login", "api-key", "openai"],
        env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    const encoder = new TextEncoder();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await writer.write(encoder.encode("sk-runwield-package-smoke"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await writer.write(encoder.encode("\r"));
    await writer.close();
    const timeout = setTimeout(() => {
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
    }, 5_000);
    try {
        const output = await child.output();
        const text = `${new TextDecoder().decode(output.stdout)}${new TextDecoder().decode(output.stderr)}`;
        const authText = await Deno.readTextFile(join(env.USERPROFILE, ".wld", "auth.json")).catch(() => "");
        if (!authText.includes("openai")) {
            throw new Error(`Provider setup did not persist the package-check credential:\n${text}`);
        }
        await Deno.writeTextFile(
            join(env.USERPROFILE, ".wld", "settings.json"),
            JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4.1", notifications: { enabled: false } }),
        );
    } finally {
        clearTimeout(timeout);
    }
}

/** @param {string} exe @param {Record<string, string>} env */
async function checkWorkspacePairingAndArtifacts(exe, env) {
    const home = env.USERPROFILE;
    const projectRoot = join(home, "workspace-artifact-project");
    const fixture = await makeManagedSessionFixture({ home, projectRoot });
    try {
        await Deno.writeTextFile(
            join(projectRoot, "artifact.md"),
            "# Windows package artifact\n\nWorkspace artifact smoke.\n",
        );
        const artifact = fixture.registerArtifact("artifact.md", "Windows package artifact");

        const port = 48_787;
        const server = new Deno.Command(exe, {
            args: ["workspace", "serve", "--port", String(port), "--no-open"],
            env,
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        try {
            const origin = `http://127.0.0.1:${port}`;
            for (let attempt = 0; attempt < 50; attempt += 1) {
                if (await fetch(`${origin}/pair`).then((response) => response.ok).catch(() => false)) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const pairing = await fetch(`${origin}/api/owner/pairing/request`, {
                method: "POST",
                headers: { "content-type": "application/json", origin },
                body: JSON.stringify({ deviceLabel: "Windows package check" }),
            });
            if (pairing.status !== 201) throw new Error(`Workspace pairing request failed with ${pairing.status}.`);
            const proofCookie = pairing.headers.get("set-cookie")?.match(/rw_pairing_proof=([^;]+)/)?.[1];
            const { code } = await pairing.json();
            if (!code || !proofCookie) throw new Error("Workspace pairing did not return a code and proof cookie.");
            await run(exe, ["workspace", "pair", code], { env });
            const claim = await fetch(`${origin}/api/owner/pairing/claim`, {
                method: "POST",
                headers: { cookie: `rw_pairing_proof=${proofCookie}`, origin },
            });
            if (claim.status !== 201) throw new Error(`Workspace pairing claim failed with ${claim.status}.`);
            const deviceCookie = claim.headers.get("set-cookie")?.match(/rw_owner_device=([^;]+)/)?.[1];
            if (!deviceCookie) throw new Error("Workspace pairing did not issue an owner device cookie.");
            const artifactResponse = await fetch(
                `${origin}/projects/${fixture.project.projectId}/sessions/${fixture.session.runwieldSessionId}/artifacts/${artifact.artifactId}`,
                { headers: { cookie: `rw_owner_device=${deviceCookie}` } },
            );
            const artifactText = await artifactResponse.text();
            if (artifactResponse.status !== 200 || !artifactText.includes("Workspace artifact smoke")) {
                throw new Error(
                    `Workspace artifact retrieval failed with ${artifactResponse.status}:\n${artifactText}`,
                );
            }
            const wrongSession = await fetch(
                `${origin}/projects/${fixture.project.projectId}/sessions/missing/artifacts/${artifact.artifactId}`,
                { headers: { cookie: `rw_owner_device=${deviceCookie}` } },
            );
            if (wrongSession.status !== 404) {
                throw new Error(`Unrelated Session artifact returned ${wrongSession.status}.`);
            }
        } finally {
            server.kill("SIGTERM");
            await server.output().catch(() => null);
        }
    } finally {
        await fixture.cleanup();
    }
}

/** @param {string} exe @param {Record<string, string>} env */
async function checkPublicationFlow(exe, env) {
    await run(exe, ["package-smoke", "publication"], { env: { ...env, WLD_INTERNAL_PACKAGE_CHECK: "1" } });
}

async function main(args = Deno.args) {
    const options = parseArgs(args);
    if (Deno.build.os !== "windows") throw new Error("package:windows:check must run on native Windows.");
    const root = await Deno.makeTempDir({ prefix: "runwield-windows-check-" });
    try {
        const extract = join(root, "Run Wield Package");
        await Deno.mkdir(extract, { recursive: true });
        await run("powershell", [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath ${JSON.stringify(options.packagePath)} -DestinationPath ${
                JSON.stringify(extract)
            } -Force`,
        ]);
        const exe = join(extract, "wld.exe");
        for (
            const path of [
                "runtime/helpers/mnemoteca.exe",
                "runtime/helpers/cymbal.exe",
                "runtime/helpers/ketch.exe",
                "runtime/helpers/agent-browser.exe",
                "licenses/RUNWIELD-LICENSE.txt",
                "licenses/mnemoteca-LICENSE.txt",
                "licenses/cymbal-LICENSE.txt",
                "licenses/ketch-LICENSE.txt",
                "licenses/agent-browser-LICENSE.txt",
            ]
        ) await assertFile(join(extract, path));
        const metadata = JSON.parse(await Deno.readTextFile(join(extract, "runwield-install.json")));
        if (metadata.packageManager !== "winget" || metadata.packageIdentifier !== "Gandazgul.RunWield") {
            throw new Error("Package metadata does not identify Gandazgul.RunWield WinGet ownership.");
        }
        const home = join(root, "User Profile");
        await Deno.mkdir(home, { recursive: true });
        const systemPath = Deno.env.get("SystemRoot") ? `${Deno.env.get("SystemRoot")}\\System32` : "";
        const hostPath = Deno.env.get("PATH") || "";
        const cleanEnv = {
            HOME: "",
            USERPROFILE: home,
            APPDATA: join(home, "AppData", "Roaming"),
            LOCALAPPDATA: join(home, "AppData", "Local"),
            MNEMOTECA_DB_PATH: join(home, "AppData", "Local", "mnemoteca", "smoke.db"),
            PATH: [systemPath, hostPath].filter(Boolean).join(";"),
        };
        const version = await run(exe, ["--version"], { env: cleanEnv });
        const help = await run(exe, ["--help"], { env: cleanEnv });
        const update = await run(exe, ["update", "--rc"], { env: cleanEnv });
        if (!version.stdout.includes(`runwield ${metadata.version} (`)) {
            throw new Error("wld --version did not match package metadata.");
        }
        if (!help.stdout.toLowerCase().includes("usage")) throw new Error("wld --help did not print help.");
        if (!update.stdout.includes("winget upgrade --id Gandazgul.RunWield --exact")) {
            throw new Error("wld update did not print the WinGet upgrade command.");
        }
        await checkProviderSetupLaunch(exe, cleanEnv);
        await checkAcpProtocolExchange(exe, cleanEnv);
        await checkWorkspacePairingAndArtifacts(exe, cleanEnv);
        await checkPublicationFlow(exe, cleanEnv);
        await checkCoreHelperFlows(exe, cleanEnv);
        await run("cmd", ["/c", exe, "--version"], { env: cleanEnv });
        console.log(`${basename(options.packagePath)} passed native Windows package smoke checks.`);
    } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
}

if (import.meta.main) await main();
