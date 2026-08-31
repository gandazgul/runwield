/**
 * @module cli
 * RunWield — Plan-by-Default Coding Harness
 *
 * Usage:
 *   wld "<user request>"
 *   wld router "<user request>"
 *   wld load-plan <plan-name-or-path>
 *   wld plans
 *   wld sleep
 *   wld help
 *
 * Source-run fallback for contributors:
 *   deno run -A src/cli.ts "<user request>"
 */

import { createRequire } from "node:module";
import { parseArgs } from "@std/cli/parse-args";
import { getCwd } from "./constants.js";
import { cleanupAgentBrowserSessionSync, initializeAgentBrowserSession } from "./shared/agent-browser-session.ts";

initializeAgentBrowserSession();

if (Deno.build.standalone) {
    Object.defineProperty(globalThis, "require", {
        value: createRequire(import.meta.url),
        configurable: true,
    });
}
import { runVersionCommand } from "./cmd/version/index.js";

function stripLeadingGlobalFlags(argv: string[]): string[] {
    const stripped: string[] = [];
    let stillInGlobalPrefix = true;

    for (const arg of argv) {
        if (
            stillInGlobalPrefix &&
            (arg === "--help" || arg === "-h" || arg === "--continue" || arg === "-c" || arg === "--version" ||
                arg === "-v")
        ) {
            continue;
        }
        stillInGlobalPrefix = false;
        stripped.push(arg);
    }

    return stripped;
}

function isHelpFlag(arg: string): boolean {
    return arg === "--help" || arg === "-h";
}

function isGlobalFlag(arg: string): boolean {
    return isHelpFlag(arg) || arg === "--continue" || arg === "-c";
}

function resolveHelpRequest(
    argv: string[],
    commandNames: { HELP: string },
): { requested: false } | { requested: true; commandName?: string } {
    if (argv[0] === commandNames.HELP) {
        const commandName = argv.slice(1).find((arg) => !isHelpFlag(arg));
        return commandName ? { requested: true, commandName } : { requested: true };
    }

    if (!argv.some(isHelpFlag)) return { requested: false };

    const commandName = argv.find((arg) => !isGlobalFlag(arg));
    return commandName ? { requested: true, commandName } : { requested: true };
}

async function main(): Promise<void> {
    const args = Deno.args;

    const parsed = parseArgs(args, {
        stopEarly: true,
        boolean: ["help", "continue", "version"],
        string: ["mode"],
        alias: { h: "help", c: "continue", v: "version" },
    });

    const normalizedArgs = stripLeadingGlobalFlags(args);
    const [firstPositional] = parsed._.map(String);

    if (parsed.version) {
        await runVersionCommand();
        return;
    }

    const { COMMAND_NAMES, commandRegistry, getCommandDefinition, hasCommandSurface } = await import(
        "./cmd/registry.js"
    );
    const { printCommandHelp, printGlobalHelp } = await import("./cmd/help/index.js");

    const helpRequest = resolveHelpRequest(args, COMMAND_NAMES);
    if (helpRequest.requested) {
        if (!helpRequest.commandName) {
            printGlobalHelp();
            return;
        }
        if (!printCommandHelp(helpRequest.commandName)) {
            console.error(`[RunWield] Unknown command for help: ${helpRequest.commandName}`);
            console.log();
            Deno.exit(1);
        }
        return;
    }

    if (parsed.mode === "acp") {
        const { runAcpCommand } = await import("./cmd/acp/index.js");
        await runAcpCommand([]);
        return;
    }

    if (firstPositional === "guided-review") {
        await runGuidedReviewCommand();
        return;
    }

    if (firstPositional === "plans") {
        const { runPlansCommand } = await import("./cmd/plans/index.ts");
        const [, ...commandArgs] = normalizedArgs;
        await runPlansCommand(commandArgs);
        return;
    }

    const positionalCommand = getCommandDefinition(firstPositional);
    if (positionalCommand) {
        if (!hasCommandSurface(positionalCommand, "cli")) {
            console.error(
                `[RunWield] Command '${firstPositional}' is only available inside interactive chat as /${firstPositional}.`,
            );
            Deno.exit(1);
        }
        const [, ...commandArgs] = normalizedArgs;
        await positionalCommand.execute(commandArgs);
        return;
    }

    if (parsed.help) {
        printGlobalHelp();
        return;
    }

    if (normalizedArgs[0]?.startsWith("-")) {
        console.error(`[RunWield] Unknown option: ${normalizedArgs[0]}`);
        console.error("Use positional commands, for example: wld <command> [args]");
        Deno.exit(1);
    }

    await commandRegistry[COMMAND_NAMES.ROUTER].execute(normalizedArgs, {
        sessionStartMode: parsed.continue ? "continue" : "new",
    });
}

async function runGuidedReviewCommand(): Promise<void> {
    const prompt = await new Response(Deno.stdin.readable).text();
    if (!prompt.trim()) {
        console.error("RunWield Guided Review requires a prompt on stdin.");
        Deno.exit(1);
    }
    const { createSessionRuntime } = await import("./shared/session/session-runtime.js");
    const runtime = createSessionRuntime({ ownerProcessKind: "workspace" });
    const sessionId = await runtime.createPromptReadySession({ cwd: getCwd(), agentName: "guide" });
    try {
        const result = await runtime.promptSession(sessionId, {
            initialRequest: prompt,
            emitInitialEvents: false,
        });
        if (!result.ok) throw new Error(result.error || "Guided Review generation failed.");
        const output = await runtime.getLastAssistantText(sessionId);
        if (!output) throw new Error("RunWield Guided Review returned no assistant output.");
        console.log(output);
    } finally {
        runtime.closeSession(sessionId);
    }
}

try {
    await main();
} catch (err) {
    try {
        const { stopTUI } = await import("./ui/tui/tui.ts");
        stopTUI();
    } catch (_error) {
        // Ignore cleanup failures during fatal error reporting.
    }
    if (err instanceof Error && err.message.includes("Mnemosyne binary not found")) {
        console.error(err.message);
    } else {
        console.error("[RunWield] Fatal error:", err);
    }
    cleanupAgentBrowserSessionSync();
    Deno.exit(1);
} finally {
    cleanupAgentBrowserSessionSync();
}
