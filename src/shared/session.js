/**
 * @module shared/session
 * Shared helpers for loading agents and running streamed sessions.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { AGENTS_DIR, CORE_SYSTEM_PROMPT, CWD } from "../constants.js";

const PROJECT_AGENTS_DIR = join(CWD, ".pi", "agents");

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function directoryExists(path) {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Resolve prompt directory with bundled-first strategy.
 * 1) Bundled agents shipped with Harness binary
 * 2) Project-local .pi/agents fallback
 *
 * @returns {Promise<string>}
 */
async function resolveAgentDir() {
  if (await directoryExists(AGENTS_DIR)) return AGENTS_DIR;
  if (await directoryExists(PROJECT_AGENTS_DIR)) return PROJECT_AGENTS_DIR;

  throw new Error(
    `Could not find bundled agent prompts at ${AGENTS_DIR} or project prompts at ${PROJECT_AGENTS_DIR}`,
  );
}

/**
 * @typedef {Object} AgentDef
 * @property {string} name - Agent name (from frontmatter or filename)
 * @property {string} model - Model identifier
 * @property {string} systemPrompt - Core prompt + agent-specific prompt
 */

/**
 * Load an agent definition from `.pi/agents/<name>.md`.
 *
 * @param {string} agentName
 * @param {string} [agentDir]
 * @returns {Promise<AgentDef>}
 */
export async function loadAgent(agentName, agentDir) {
  const resolvedAgentDir = agentDir || await resolveAgentDir();
  const filePath = join(resolvedAgentDir, `${agentName}.md`);
  const raw = await Deno.readTextFile(filePath);

  if (!hasFrontMatter(raw)) {
    throw new Error(`Agent file ${filePath} has no frontmatter`);
  }

  const { attrs, body } = extractYaml(raw);
  const name = attrs.name || agentName;
  const model = attrs.model || "claude-sonnet-4-20250514";
  const systemPrompt = CORE_SYSTEM_PROMPT + "\n\n" + body.trim();

  return { name, model, systemPrompt };
}

/**
 * Run an agent session and wait for idle.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} opts.toolNames
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} opts.prompt
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>}
 */
export async function runSession(
  { agentName, toolNames, customTools, prompt },
) {
  const agentDir = await resolveAgentDir();
  const agentDef = await loadAgent(agentName, agentDir);
  console.log(
    `\n[Harness] Loading agent: ${agentDef.name} (model: ${agentDef.model})`,
  );

  const loader = new DefaultResourceLoader({
    cwd: CWD,
    agentDir,
    systemPromptOverride: () => agentDef.systemPrompt,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: CWD,
    tools: [...toolNames, ...(customTools || []).map((t) => t.name)],
    customTools: customTools || [],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
  });

  session.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        if (event.assistantMessageEvent.type === "text_delta") {
          Deno.stdout.writeSync(
            new TextEncoder().encode(event.assistantMessageEvent.delta),
          );
        }
        break;
      }
      case "tool_execution_start": {
        const filePath = getFilePathForTool(event.toolName, event.args);
        if (filePath) {
          console.log(`\n  [Tool] ${event.toolName}\n  📄 ${filePath}`);
        } else {
          console.log(`\n  [Tool] ${event.toolName}`);
        }
        if (event.toolName === "bash") {
          console.log(`    Command: ${event.args?.command || "N/A"}`);
        }
        break;
      }
      case "tool_execution_end": {
        console.log(
          `  [Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`,
        );
        break;
      }
    }
  });

  await session.prompt(prompt);
  await session.agent.waitForIdle();

  return session.agent.state.messages;
}

/**
 * Extract file path from tool arguments for read/edit/write tools.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {string | null}
 */
function getFilePathForTool(toolName, args) {
  if (!args) return null;

  switch (toolName) {
    case "read":
    case "edit":
    case "write": {
      const path = typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
        ? args.file_path
        : null;
      return path;
    }
    default:
      return null;
  }
}
