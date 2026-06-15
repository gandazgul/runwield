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

export const HOME_DIR = Deno.env.get("HOME") || "";

/** Known CLI command names. */
/** @type {Readonly<{ROUTER: string, AGENT: string, MODEL: string, LOGIN: string, LOGOUT: string, STATUS: string, EXPORT: string, SHARE: string, LOAD_PLAN: string, RESUME: string, NEW: string, SESSION: string, PLANS: string, SLEEP: string, HELP: string, QUIT: string, EXIT: string, INIT: string, THEME: string, INSTALL: string, REMOVE: string, COMPACT: string, RELOAD: string}>} */
export const COMMAND_NAMES = Object.freeze({
    ROUTER: "router",
    AGENT: "agent",
    MODEL: "model",
    LOGIN: "login",
    LOGOUT: "logout",
    STATUS: "status",
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
    THEME: "theme",
    INSTALL: "install",
    REMOVE: "remove",
    COMPACT: "compact",
    RELOAD: "reload",
});

/**
 * Canonical agent identifiers. Most values match an agent definition filename
 * (without the `.md` extension) in `src/agent-definitions/`. The display name
 * for standard agents is the `name:` field inside that file and must be loaded
 * via `getAgentDisplayName()` from `shared/session/agents.js` — never
 * hardcoded.
 *
 * `INIT` is a special pseudo-agent loaded from `src/cmd/init/init-agent-prompt.md`
 * by path rather than the agent-definitions directory, so it does not appear
 * in `/agent` listings.
 *
 * `SLICER` is a workflow-only pseudo-agent loaded from
 * `src/shared/workflow/slicer-prompt.md`, so it also does not appear in
 * `/agent` listings or return_to_router targets.
 */
/** @type {Readonly<{ROUTER: string, OPERATOR: string, PLANNER: string, ARCHITECT: string, ENGINEER: string, REVIEWER: string, SLICER: string, TESTER: string, IDEATOR: string, DOC_WRITER: string, INIT: string}>} */
export const AGENTS = Object.freeze({
    ROUTER: "router",
    OPERATOR: "operator",
    PLANNER: "planner",
    ARCHITECT: "architect",
    ENGINEER: "engineer",
    REVIEWER: "reviewer",
    SLICER: "slicer",
    TESTER: "tester",
    IDEATOR: "ideator",
    DOC_WRITER: "doc-writer",
    INIT: "init",
});

/** Max concurrent agent tasks for PROJECT execution. */
export const MAX_PARALLEL_TASKS = 4;
