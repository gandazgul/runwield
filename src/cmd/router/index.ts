/** Router command, also used as the default command. */

import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp } from "../help/index.ts";
import { startInteractiveSession } from "../../ui/tui/chat-session.js";

interface InteractiveSessionPort {
    startInteractiveSession(
        userRequest: string | null,
        options: { sessionStartMode?: "new" | "continue" },
    ): Promise<import("../../ui/tui/types.js").UiAPI | void>;
}

interface RouterCommandOptions {
    sessionStartMode?: "new" | "continue";
    sessionPort?: InteractiveSessionPort;
}

const DEFAULT_SESSION_PORT: InteractiveSessionPort = { startInteractiveSession };

export async function runRouterCommand(
    argv: string[],
    options: RouterCommandOptions = {},
): Promise<void> {
    const userRequest = argv.join(" ").trim();

    if (userRequest === "help") {
        printCommandHelp(COMMAND_NAMES.ROUTER);
        return;
    }

    const sessionPort = options.sessionPort || DEFAULT_SESSION_PORT;
    await sessionPort.startInteractiveSession(userRequest || null, {
        sessionStartMode: options.sessionStartMode || "new",
    });
}
