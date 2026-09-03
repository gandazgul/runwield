import { join } from "@std/path";
import { getHomeDir } from "../../../../../constants.js";

interface JsonRecord {
    [key: string]: string | number | boolean | JsonRecord;
}

function readArg(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] || "" : "";
}

function emit(value: JsonRecord): void {
    console.log(JSON.stringify(value));
}

async function main(): Promise<void> {
    const args = Deno.args;
    const logPath = Deno.env.get("RUNWIELD_AGY_FIXTURE_LOG");
    if (logPath) await Deno.writeTextFile(logPath, `${JSON.stringify({ args })}\n`, { append: true, create: true });

    const prompt = readArg(args, "-p");
    const outputFormat = readArg(args, "--output-format");
    const home = getHomeDir();
    if (prompt === "/agents" && outputFormat === "json") {
        const agentsRoot = join(home, ".gemini", "config", "agents");
        const agents: string[] = [];
        try {
            for await (const entry of Deno.readDir(agentsRoot)) {
                if (entry.isFile && entry.name.endsWith(".md")) agents.push(entry.name.slice(0, -3));
            }
        } catch {
            // No agents directory yet.
        }
        console.log(JSON.stringify({ agents: agents.map((name) => ({ name })) }));
        return;
    }

    const agentName = readArg(args, "--agent");
    if (!agentName) {
        console.error("missing --agent");
        Deno.exit(2);
    }
    const definitionPath = join(home, ".gemini", "config", "agents", `${agentName}.md`);
    const definition = await Deno.readTextFile(definitionPath);
    const markerMatch = definition.match(/AGENT_MARKER=([^\s]+)/);
    const marker = markerMatch?.[1] || "missing-agent-marker";
    emit({ type: "init", agent: agentName, session_id: "fake-session" });
    emit({ type: "step_update", update_type: "tool_info", tool_info: { name: "display-only" } });
    emit({ type: "step_update", update_type: "text_delta", text: marker.slice(0, Math.ceil(marker.length / 2)) });
    emit({ type: "step_update", update_type: "text_delta", text: marker.slice(Math.ceil(marker.length / 2)) });
    emit({ type: "result", result: marker, usage: { input_tokens: 11, output_tokens: 13 } });
}

await main();
