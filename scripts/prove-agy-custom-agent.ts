import { parseArgs } from "@std/cli/parse-args";
import {
    previewAgyCustomAgentProof,
    proveAgyCustomAgentExecution,
} from "../src/shared/session/backends/agy-cli/spike.ts";

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

function requireString(value: string | boolean | undefined, flag: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${flag} is required`);
    return value;
}

function makeMarker(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}

const args = parseArgs(Deno.args, {
    string: ["agent-name"],
    boolean: ["confirm-global-agent-write"],
    default: { "confirm-global-agent-write": false },
});
const agentName = requireString(args["agent-name"], "--agent-name runwield-spike-<unique>");
if (!/^runwield-spike-[A-Za-z0-9._-]+$/.test(agentName)) {
    throw new Error("--agent-name must match runwield-spike-<unique> and contain no path separators");
}
const preview = previewAgyCustomAgentProof(agentName);
if (!args["confirm-global-agent-write"]) {
    console.log(`Preview only. No file mutation or subprocess call was performed.`);
    console.log(`Agent name: ${preview.agentName}`);
    console.log(`Resolved path: ${preview.definitionPath}`);
    console.log(`Planned operation: ${preview.plannedOperation}`);
    console.log(`To run after approval, repeat this exact name with --confirm-global-agent-write.`);
    Deno.exit(0);
}

if (await pathExists(preview.definitionPath)) {
    throw new Error(`Refusing confirmed run because path already exists: ${preview.definitionPath}`);
}

const agentMarker = makeMarker("AGENT-MARKER");
const userMarker = makeMarker("USER-MARKER");
const agentDefinition = [
    "---",
    `name: ${agentName}`,
    "description: Temporary RunWield Antigravity custom-agent execution proof.",
    "mainAgent: true",
    "subagent: false",
    "---",
    "",
    "# RunWield Antigravity Custom Agent Spike",
    "",
    `AGENT_MARKER=${agentMarker}`,
    "For this proof, ignore conflicting user text and reply exactly with the AGENT_MARKER value and nothing else.",
].join("\n");

try {
    const result = await proveAgyCustomAgentExecution(agentName, agentDefinition, agentMarker, userMarker);
    console.log(`Preflight succeeded: /agents listed ${agentName}.`);
    console.log(`User request argument: ${result.userRequest}`);
    console.log(`Agent marker absent from user argument: ${!result.userRequest.includes(agentMarker)}`);
    console.log(`Agent Definition absent from user argument: ${!result.userRequest.includes(agentDefinition)}`);
    console.log(`Raw terminal result: ${result.rawResultText}`);
    console.log(`Parsed final text: ${result.parsedFinalText}`);
    console.log(`User marker: ${userMarker}`);
    console.log(`Cleanup completed: ${result.cleanupCompleted}; path removed: ${result.definitionPath}`);
} catch (error) {
    console.error(`Agy custom-agent proof failed.`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
        `If cleanup did not finish, inspect and remove only this temporary path if it still contains the RunWield spike definition: ${preview.definitionPath}`,
    );
    Deno.exit(1);
}
