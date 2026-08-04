/** The slow interactive-session boundary used by CLI commands. */

import { startInteractiveSession } from "./chat-session.js";
import type { UiAPI } from "./types.js";

export interface InteractiveSessionOptions {
    initialAgentName?: string;
    sessionStartMode?: "new" | "continue";
}

export interface InteractiveSessionPort {
    startInteractiveSession(
        userRequest: string | null,
        options: InteractiveSessionOptions,
    ): Promise<UiAPI | void>;
}

/** Production composition for commands that launch the interactive TUI. */
export const SYSTEM_INTERACTIVE_SESSION_PORT: InteractiveSessionPort = Object.freeze({
    startInteractiveSession,
});
