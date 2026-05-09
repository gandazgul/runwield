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

/** Directory containing bundled default prompt template markdown files. */
export const PROMPT_TEMPLATES_DIR = join(SRC_DIR, "prompt-templates");

/** Directory containing bundled default skill definitions. */
export const SKILLS_DIR = join(SRC_DIR, "skills");

/** Allowed triage classification values emitted by the router. */
export const CLASSIFICATIONS = ["QUICK_FIX", "FEATURE", "PROJECT"];

/** Allowed complexity values emitted by triage. */
export const COMPLEXITIES = ["LOW", "MEDIUM", "HIGH"];

/** Directory name where plan markdown files are stored. */
export const PLANS_DIR_NAME = "plans";

/** Known CLI command names. */
/** @type {Readonly<{ROUTER: string, AGENT: string, MODEL: string, EXPORT: string, SHARE: string, LOAD_PLAN: string, RESUME: string, NEW: string, SESSION: string, PLANS: string, SLEEP: string, HELP: string, QUIT: string, EXIT: string, INIT: string}>} */
export const COMMAND_NAMES = Object.freeze({
    ROUTER: "router",
    AGENT: "agent",
    MODEL: "model",
    EXPORT: "export",
    SHARE: "share",
    LOAD_PLAN: "load-plan",
    RESUME: "resume",
    NEW: "new",
    SESSION: "session",
    PLANS: "plans",
    SLEEP: "sleep",
    HELP: "help",
    QUIT: "quit",
    EXIT: "exit",
    INIT: "init",
});

/** Max concurrent agent tasks for PROJECT execution. */
export const MAX_PARALLEL_TASKS = 4;
