import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { printCommandHelp, printGlobalHelp, runHelpCommand } from "./index.ts";

const decoder = new TextDecoder();

async function runHelpChild(argv: string[]): Promise<Deno.CommandOutput> {
    const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-help-command-" });
    const homeDir = join(fixtureRoot, "home");
    const projectRoot = join(fixtureRoot, "project");
    await Promise.all([
        Deno.mkdir(homeDir, { recursive: true }),
        Deno.mkdir(projectRoot, { recursive: true }),
    ]);
    const moduleUrl = import.meta.resolve("./index.ts");
    const configPath = fromFileUrl(new URL("../../../deno.json", import.meta.url));
    const source = `import { runHelpCommand } from ${JSON.stringify(moduleUrl)};\n` +
        `await runHelpCommand(${JSON.stringify(argv)});\n`;
    try {
        return await new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", configPath, source],
            cwd: projectRoot,
            env: {
                HOME: homeDir,
                WLD_TEST_SANDBOX_HOME: homeDir,
            },
            stdout: "piped",
            stderr: "piped",
        }).output();
    } finally {
        await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
    }
}

function decodeCommandStderr(output: Uint8Array): string {
    const denoLockNotice = "\u001b[0m\u001b[36mBlocking\u001b[0m waiting for file lock on node_modules directory";
    return decoder.decode(output).split("\n").filter((line) => {
        const plainLine = line.replaceAll("\u001b[0m", "").replaceAll("\u001b[32m", "").replaceAll("\u001b[36m", "");
        return line !== denoLockNotice && !plainLine.startsWith("Download https://registry.npmjs.org/");
    }).join("\n");
}

async function captureLogs(run: () => void | Promise<void>): Promise<string[]> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.log = original;
    }
    return logs;
}

Deno.test("help formatters read the real command registry", async () => {
    assertEquals(printCommandHelp("does-not-exist"), false);

    const globalLogs = await captureLogs(() => printGlobalHelp());
    assertStringIncludes(globalLogs.join("\n"), "Usage:");
    assertStringIncludes(globalLogs.join("\n"), "router");

    const commandLogs = await captureLogs(() => runHelpCommand(["model"]));
    assertStringIncludes(commandLogs.join("\n"), "Usage (model):");
});

Deno.test("help command renders through the passed-in TUI surface", async () => {
    const messages: Array<{ message: string; isError: boolean }> = [];
    const uiAPI = {
        appendSystemMessage(message: string, isError = false): void {
            messages.push({ message, isError });
        },
    };

    await runHelpCommand(["model"], { uiAPI });
    await runHelpCommand(["does-not-exist"], { uiAPI });

    assertStringIncludes(messages[0].message, "Usage (model):");
    assertEquals(messages[0].isError, false);
    assertEquals(messages[1], {
        message: "[RunWield] Unknown command for help: does-not-exist",
        isError: true,
    });
});

Deno.test("unknown CLI help exits the isolated process with status one", async () => {
    const result = await runHelpChild(["does-not-exist"]);

    assertEquals(result.code, 1);
    assertStringIncludes(decodeCommandStderr(result.stderr), "Unknown command for help: does-not-exist");
    assertEquals(decoder.decode(result.stdout), "\n");
});

Deno.test("help flags use real argument parsing in an isolated project", async () => {
    const result = await runHelpChild(["--help"]);

    assertEquals(result.code, 0);
    assertStringIncludes(decoder.decode(result.stdout), "RunWield — Plan-by-Default Coding Harness");
    assertEquals(decodeCommandStderr(result.stderr), "");
});
