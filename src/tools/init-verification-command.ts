import { Type } from "@earendil-works/pi-ai";
import { type AgentToolResult, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { setCustomSetting } from "../shared/settings.js";

export const INIT_VERIFICATION_COMMAND_TOOL_NAME = "init_save_verification_command";
export const INIT_VERIFICATION_COMMAND_PLACEHOLDER = 'echo "verification not implemented yet"';

const PARAMETERS = Type.Object({
    command: Type.Optional(Type.String({
        description: "User-confirmed shell command for project verification.",
    })),
    verificationNotImplemented: Type.Optional(Type.Boolean({
        description: "Set true when the user confirms that project verification is not implemented.",
    })),
}, { additionalProperties: false });

interface InitVerificationCommandDetails {
    outcome: "saved" | "rejected";
    verificationCommand?: string;
    reason?: string;
}

type InitVerificationCommandResult = AgentToolResult<InitVerificationCommandDetails>;

export interface InitVerificationCommandOperation {
    tool: ToolDefinition;
    getConfirmedCommand(): string | undefined;
}

export interface InitVerificationCommandOperationOptions {
    projectRoot: string;
}

function reject(reason: string): InitVerificationCommandResult {
    return {
        content: [{ type: "text", text: `Verification command was not saved: ${reason}` }],
        details: { outcome: "rejected", reason },
    };
}

function resolveVerificationCommand(params: { command?: string; verificationNotImplemented?: boolean }): string | null {
    const command = params.command?.trim() || "";
    const usesPlaceholder = params.verificationNotImplemented === true;

    if (usesPlaceholder && command) return null;
    if (!usesPlaceholder && !command) return null;
    if (usesPlaceholder) return INIT_VERIFICATION_COMMAND_PLACEHOLDER;
    return command;
}

export function createInitVerificationCommandOperation(
    options: InitVerificationCommandOperationOptions,
): InitVerificationCommandOperation {
    let confirmedCommand: string | undefined;
    const tool = defineTool<typeof PARAMETERS, InitVerificationCommandDetails>({
        name: INIT_VERIFICATION_COMMAND_TOOL_NAME,
        label: "Save Init Verification Command",
        description: "Save the user-confirmed project verification command to project settings during Init.",
        promptSnippet:
            "init_save_verification_command(command | verificationNotImplemented): Save the user-confirmed project verification command in project settings.",
        parameters: PARAMETERS,
        async execute(_toolCallId, params): Promise<InitVerificationCommandResult> {
            const command = resolveVerificationCommand(params);
            if (!command) {
                return reject(
                    "Provide exactly one resolved outcome: a non-empty command or verificationNotImplemented true.",
                );
            }

            await setCustomSetting("verification_command", command, "project", options.projectRoot);
            confirmedCommand = command;
            return {
                content: [{ type: "text", text: `Saved project verification command: ${command}` }],
                details: { outcome: "saved", verificationCommand: command },
            };
        },
    });

    return {
        tool,
        getConfirmedCommand: () => confirmedCommand,
    };
}
