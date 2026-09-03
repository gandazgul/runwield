import { assertRunWieldAgentName } from "./custom-agent.ts";

export interface AgyCliRunRequest {
    agentName: string;
    userRequest: string;
}

export interface PreparedAgyCliCommand {
    command: "agy";
    args: string[];
    env: Record<string, string>;
}

export function prepareAgyCliStreamCommand(request: AgyCliRunRequest): PreparedAgyCliCommand {
    assertRunWieldAgentName(request.agentName);
    if (!request.userRequest) throw new Error("Agy user request is required");
    return {
        command: "agy",
        args: ["-p", request.userRequest, "--agent", request.agentName, "--output-format", "stream-json"],
        env: {},
    };
}

export function prepareAgyCliAgentsCommand(): PreparedAgyCliCommand {
    return { command: "agy", args: ["-p", "/agents", "--output-format", "json"], env: {} };
}
