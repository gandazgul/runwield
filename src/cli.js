/**
 * @module cli
 * Harness PoC — Triage & Plan Loop
 *
 * Usage: deno run -A src/cli.js "<user request>"
 *
 * Flow:
 *   1. Router session (read + bash + triage_report) → structured classification
 *   2. If FEATURE/PROJECT → Architect session (read + edit + write + bash) → PLAN.md
 *   3. If QUICK_FIX → Operator session (read + edit + write + bash) → execute the task
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { triageReportTool } from "./tools/triage-report.js";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";

// ─── Constants ────────────────────────────────────────────────────────

const CWD = Deno.cwd();
const AGENTS_DIR = join(CWD, ".pi", "agents");

const CORE_SYSTEM_PROMPT = [
  "You are part of the Harness system — a plan-by-default coding harness.",
  "Always be concise, thorough, and precise in your analysis.",
  "When you use tools, explain briefly what you're looking for.",
].join("\n");

// ─── Agent Loading ────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentDef
 * @property {string} name - Agent name (from frontmatter or filename)
 * @property {string} model - Model identifier (from frontmatter)
 * @property {string} systemPrompt - Core prompt + agent-specific prompt
 */

/**
 * Load an agent definition from a markdown file.
 * Parses YAML frontmatter for metadata; uses the body as the agent prompt.
 * Prepends the core Harness system prompt.
 *
 * @param {string} agentName - Filename without extension (e.g., "router")
 * @returns {Promise<AgentDef>} The parsed agent definition
 */
async function loadAgent(agentName) {
  const filePath = join(AGENTS_DIR, `${agentName}.md`);
  const raw = await Deno.readTextFile(filePath);

  if (!hasFrontMatter(raw)) {
    throw new Error(`Agent file ${filePath} has no frontmatter`);
  }

  const { attrs, body } = extractYaml(raw);
  const name = attrs.name || agentName;
  const model = attrs.model || "claude-sonnet-4-20250514";

  /** @type {string} */
  const systemPrompt = CORE_SYSTEM_PROMPT + "\n\n" + body.trim();

  return { name, model, systemPrompt };
}

// ─── Session Helpers ──────────────────────────────────────────────────

/**
 * Create and run an agent session, returning after the agent goes idle.
 * Logs streaming events to the console.
 *
 * @param {Object} opts
 * @param {string} opts.agentName - Which agent .md to load
 * @param {string[]} opts.toolNames - Built-in tool names to enable
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools] - Custom tools
 * @param {string} opts.prompt - The user message to send
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>} Conversation messages
 */
async function runSession({ agentName, toolNames, customTools, prompt }) {
  const agentDef = await loadAgent(agentName);
  console.log(`\n[Harness] Loading agent: ${agentDef.name}`);

  const loader = new DefaultResourceLoader({
    cwd: CWD,
    agentDir: AGENTS_DIR,
    systemPromptOverride: () => agentDef.systemPrompt,
  });
  await loader.reload();

  // The session will automatically resolve the model from the agent's markdown frontmatter
  // if we omit the explicit model property here.
  const { session } = await createAgentSession({
    cwd: CWD,
    tools: [...toolNames, ...(customTools || []).map((t) => t.name)],
    customTools: customTools || [],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
  });

  // Log streaming events
  session.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          process.stdout.write(event.assistantMessageEvent.delta);
        }
        break;
      case "tool_execution_start":
        console.log(`\n  [Tool] ${event.toolName}`);
        break;
      case "tool_execution_end":
        console.log(
          `  [Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`,
        );
        break;
    }
  });

  // Send the prompt and wait for the agent to finish
  await session.prompt(prompt);
  await session.agent.waitForIdle();

  // Return the full conversation history
  return session.agent.state.messages;
}

// ─── Triage Extraction ────────────────────────────────────────────────

const CLASSIFICATIONS = ["QUICK_FIX", "FEATURE", "PROJECT"];
const COMPLEXITIES = ["LOW", "MEDIUM", "HIGH"];

/**
 * Extract the triage report from the Router's conversation messages.
 *
 * Strategy 1: Look for a toolResult from the `triage_report` tool
 *   (the model properly called the tool via the API).
 *
 * Strategy 2 (fallback): Parse the classification from the last assistant
 *   message's text content. Local/smaller models often write the tool call
 *   as prose (e.g., "triage_report: classification: FEATURE ...") instead
 *   of actually invoking it.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {{ classification: string, complexity: string, summary: string, affectedPaths: string[] } | null}
 */
function extractTriageReport(messages) {
  // Strategy 1: actual tool call result
  for (const msg of messages) {
    if (
      "role" in msg &&
      msg.role === "toolResult" &&
      "toolName" in msg &&
      msg.toolName === "triage_report"
    ) {
      // @ts-ignore — details is set by our tool's execute()
      return msg.details || null;
    }
  }

  // Strategy 2: parse from assistant text (fallback for models that
  // write the tool call as prose instead of actually calling it)
  const assistantMsgs = messages.filter(
    (m) => "role" in m && m.role === "assistant",
  );
  // Walk backwards to find the last assistant message with text
  for (let i = assistantMsgs.length - 1; i >= 0; i--) {
    const msg = assistantMsgs[i];
    if (!("content" in msg) || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== "text") continue;
      const text = block.text;
      const parsed = parseTriageFromText(text);
      if (parsed) return parsed;
    }
  }

  return null;
}

/**
 * Attempt to extract a triage report from freeform text.
 * Looks for patterns like:
 *   classification: QUICK_FIX
 *   complexity: HIGH
 *   summary: "..."
 *   affectedPaths: [...]
 *
 * @param {string} text
 * @returns {{ classification: string, complexity: string, summary: string, affectedPaths: string[] } | null}
 */
function parseTriageFromText(text) {
  // Find classification
  const classMatch = text.match(
    /classification[:\s]+(?:"?)?(QUICK_FIX|FEATURE|PROJECT)(?:"?)?/i,
  );
  if (!classMatch) return null;
  const classification = classMatch[1].toUpperCase();
  if (!CLASSIFICATIONS.includes(classification)) return null;

  // Find complexity (default to MEDIUM if not found)
  const complexMatch = text.match(
    /complexity[:\s]+(?:"?)?(LOW|MEDIUM|HIGH)(?:"?)?/i,
  );
  const complexity = complexMatch ? complexMatch[1].toUpperCase() : "MEDIUM";
  if (!COMPLEXITIES.includes(complexity)) return null;

  // Find summary — try quoted string first, then unquoted line
  let summary = "";
  const summaryQuoted = text.match(
    /summary[:\s]+"([^"]+)"/s,
  );
  if (summaryQuoted) {
    summary = summaryQuoted[1];
  } else {
    const summaryUnquoted = text.match(
      /summary[:\s]+(.+)/i,
    );
    if (summaryUnquoted) summary = summaryUnquoted[1].trim();
  }

  // Find affectedPaths — try JSON array, then YAML list
  /** @type {string[]} */
  let affectedPaths = [];
  const jsonPaths = text.match(
    /affectedPaths[:\s]+(\[[^\]]*])/s,
  );
  if (jsonPaths) {
    try {
      const parsed = JSON.parse(jsonPaths[1]);
      if (Array.isArray(parsed)) affectedPaths = parsed.map(String);
    } catch {
      // not valid JSON, ignore
    }
  }
  if (affectedPaths.length === 0) {
    // Try YAML-style: lines starting with "  - " after affectedPaths
    const yamlBlock = text.match(
      /affectedPaths[:\s]*\n((?:\s+-\s+.+\n?)*)/,
    );
    if (yamlBlock) {
      affectedPaths = [...yamlBlock[1].matchAll(/-\s+(.+)/g)].map(
        (m) => m[1].trim(),
      );
    }
  }

  return { classification, complexity, summary, affectedPaths };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Deno.args;
  if (args.length === 0) {
    console.error('Usage: deno run -A src/cli.js "<user request>"');
    Deno.exit(1);
  }

  const userRequest = args.join(" ");
  console.log(`[Harness] User request: "${userRequest}"`);

  // ── Phase A: Router ──────────────────────────────────────────────
  console.log("\n[Harness] === Phase A: Router (Triage) ===\n");

  const routerMessages = await runSession({
    agentName: "router",
    toolNames: ["read", "bash"],
    customTools: [triageReportTool],
    prompt: userRequest,
  });

  const triage = extractTriageReport(routerMessages);

  if (!triage) {
    console.error(
      "\n[Harness] ERROR: Router did not produce a triage report.",
    );
    Deno.exit(1);
  }

  console.log(
    `\n[Router] Classification: ${triage.classification}, ` +
      `Complexity: ${triage.complexity}. ` +
      `Summary: ${triage.summary}`,
  );

  // ── Phase B: Decision ────────────────────────────────────────────
  if (triage.classification === "QUICK_FIX") {
    // ── Phase B1: Operator (Execute) ──────────────────────────────
    console.log(
      `\n[Harness] QUICK_FIX detected. Handing off to Operator...\n`,
    );
    console.log("[Harness] === Phase B1: Operator (Execute) ===\n");

    const operatorPrompt = [
      `## User Request`,
      userRequest,
      ``,
      `## Triage Report`,
      `- Classification: ${triage.classification}`,
      `- Complexity: ${triage.complexity}`,
      `- Summary: ${triage.summary}`,
      `- Affected paths: ${triage.affectedPaths.join(", ")}`,
      ``,
      `Execute the task above. Inspect the current state, make the change or run the command, and verify the result.`,
    ].join("\n");

    await runSession({
      agentName: "operator",
      toolNames: ["read", "edit", "write", "bash"],
      prompt: operatorPrompt,
    });

    console.log(
      "\n[Harness] ✅ Operator session complete.",
    );
    Deno.exit(0);
  }

  // ── Phase C: Architect ───────────────────────────────────────────
  console.log(
    `\n[Harness] ${triage.classification} detected. ` +
      `Handing off to Architect...\n`,
  );
  console.log("[Harness] === Phase C: Architect (Plan) ===\n");

  const architectPrompt = [
    `## User Request`,
    userRequest,
    ``,
    `## Triage Report`,
    `- Classification: ${triage.classification}`,
    `- Complexity: ${triage.complexity}`,
    `- Summary: ${triage.summary}`,
    `- Affected paths: ${triage.affectedPaths.join(", ")}`,
    ``,
    `Based on the triage report above, explore the affected files and create a PLAN.md in the project root.`,
  ].join("\n");

  await runSession({
    agentName: "architect",
    toolNames: ["read", "edit", "write", "bash"],
    prompt: architectPrompt,
  });

  console.log(
    "\n[Harness] ✅ Architect session complete. Check PLAN.md in the project root.",
  );
}

main().catch((err) => {
  console.error("[Harness] Fatal error:", err);
  Deno.exit(1);
});
