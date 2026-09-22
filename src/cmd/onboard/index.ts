import { parseArgs } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp } from "../help/index.ts";
import type { UiAPI } from "../../ui/tui/types.js";
import type { InteractiveSessionPort } from "../../ui/tui/interactive-session-port.ts";

interface OnboardCommandOptions {
    uiAPI?: UiAPI;
    beginOnboarding?: () => Promise<void>;
    sessionPort: InteractiveSessionPort;
}

export async function runOnboardCommand(argv: string[], options: OnboardCommandOptions): Promise<void> {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });
    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.ONBOARD);
        return;
    }

    if (options.uiAPI) {
        if (!options.beginOnboarding) throw new Error("/onboard requires the interactive onboarding surface.");
        await options.beginOnboarding();
        return;
    }

    if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
        console.error("[RunWield] wld onboard requires an interactive terminal.");
        return;
    }

    await options.sessionPort.startInteractiveSession(null, { startupIntent: "onboard" });
}
