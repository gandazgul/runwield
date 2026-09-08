import { assertRunWieldAgentName } from "./custom-agent.ts";

export const AGY_CLI_PRINT_TIMEOUT = "24h";
export const AGY_CLI_PRINT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface AgyCliRunRequest {
    agentName: string;
    model: string;
    userRequest: string;
    effort: "low" | "medium" | "high";
    env?: Record<string, string>;
}

export interface PreparedAgyCliCommand {
    command: "agy";
    args: string[];
    env: Record<string, string>;
    timeoutMs?: number;
}

export function prepareAgyCliStreamCommand(request: AgyCliRunRequest): PreparedAgyCliCommand {
    assertRunWieldAgentName(request.agentName);
    if (!request.userRequest) throw new Error("Agy user request is required");
    const model = request.model.trim();
    if (!model) throw new Error("Agy model selector is required");
    if (!request.effort) throw new Error("Agy effort is required");
    const args = ["-p", request.userRequest, "--model", model, "--effort", request.effort];
    args.push(
        "--agent",
        request.agentName,
        "--output-format",
        "stream-json",
        "--disable-slash-commands",
        "--print-timeout",
        AGY_CLI_PRINT_TIMEOUT,
    );
    return {
        command: "agy",
        args,
        env: { ...(request.env || {}) },
        timeoutMs: AGY_CLI_PRINT_TIMEOUT_MS,
    };
}

export function prepareAgyCliAgentsCommand(): PreparedAgyCliCommand {
    return { command: "agy", args: ["-p", "/agents", "--output-format", "json"], env: {} };
}
