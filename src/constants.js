/**
 * @module constants
 * Shared constants for Harns CLI orchestration.
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** Name of the installed CLI binary shown in user-facing docs/help. */
export const CLI_BIN = "hns";

/** Fallback source-run invocation used in contributor docs and local dev. */
export const DEV_CLI_RUN = "deno run -A src/cli.js";

/** Current project root used by all command handlers and agent invocations. */
export const CWD = Deno.cwd();

/** Harns source root path (works for source runs and compiled binaries). */
const SRC_DIR = dirname(fromFileUrl(import.meta.url));

/** Directory containing bundled default agent definition markdown files. */
export const AGENT_DEFS_DIR = join(SRC_DIR, "agent-definitions");

/**
 * Core system guidance prepended to every agent-specific system prompt.
 * Keeps cross-agent behavior aligned with Harns expectations.
 */
export const CORE_SYSTEM_PROMPT = [
    "You are part of the Harns system — a plan-by-default coding harness.",
    "Always be concise, thorough, and precise in your analysis.",
    "When you use tools, explain briefly what you're looking for.",
].join("\n");

/** Allowed triage classification values emitted by the router. */
export const CLASSIFICATIONS = ["QUICK_FIX", "FEATURE", "PROJECT"];

/** Allowed complexity values emitted by triage. */
export const COMPLEXITIES = ["LOW", "MEDIUM", "HIGH"];

/** Directory name where plan markdown files are stored. */
export const PLANS_DIR_NAME = "plans";

/** Known CLI command names. */
export const COMMAND_NAMES = Object.freeze({
    ROUTER: "router",
    AGENTS: "agents",
    RESUME: "resume",
    PLANS: "plans",
    SLEEP: "sleep",
    HELP: "help",
});

/** Max concurrent agent tasks for PROJECT execution. */
export const MAX_PARALLEL_TASKS = 4;
