import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { checkBashCommand, describeBashAllowedCommands } from "../shared/bash-command-policy.ts";
import type { BashAllowedCommands } from "../shared/bash-command-policy.ts";

/** Preserve Pi's shell execution contract and reject restricted commands before execution. */
export function createRunWieldBashToolDefinition(cwd: string, allowedCommands?: BashAllowedCommands) {
    const base = createBashToolDefinition(cwd);
    if (allowedCommands === undefined) return base;
    return {
        ...base,
        description: `${base.description}\n${describeBashAllowedCommands(allowedCommands)}`,
        promptSnippet: `${base.promptSnippet || base.description} ${describeBashAllowedCommands(allowedCommands)}`,
        execute: async (...args: Parameters<typeof base.execute>) => {
            checkBashCommand(args[1].command, allowedCommands);
            return base.execute(...args);
        },
    };
}
