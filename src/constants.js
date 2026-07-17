/**
 * @module constants
 * Shared constants for RunWield CLI orchestration.
 */

import { join } from "@std/path";
import { RUNWIELD_SOURCE_ROOT } from "../runtime-root.js";

/** Name of the installed CLI binary shown in user-facing docs/help. */
export const CLI_BIN = "wld";

/** Fallback source-run invocation used in contributor docs and local dev. */
export const DEV_CLI_RUN = "deno run -A --unstable-no-legacy-abort src/cli.js";

/** Primary project root used for RunWield metadata, settings, and command state. */
export const CWD = Deno.cwd();

/**
 * Resolve a bundled passive resource for file APIs, not module imports.
 * Assets embedded with `deno compile --include` are rooted under `src/` in
 * both source runs and the compiled virtual filesystem.
 *
 * @param {...string} parts
 * @returns {string}
 */
function resolveBundledResourcePath(...parts) {
    return join(RUNWIELD_SOURCE_ROOT, ...parts);
}

/** Directory containing bundled default agent definition markdown files. */
export const AGENT_DEFS_DIR = resolveBundledResourcePath("agent-definitions");

/** Directory containing bundled default prompt template markdown files. */
export const PROMPT_TEMPLATES_DIR = resolveBundledResourcePath("prompt-templates");

/** Directory containing bundled default skill definitions. */
export const SKILLS_DIR = resolveBundledResourcePath("skills");

/** Path to the bundled core system prompt template. */
export const SYSTEM_PROMPT_TEMPLATE_PATH = resolveBundledResourcePath("shared", "session", "SYSTEM_PROMPT_TEMPLATE.md");

/** Directory containing bundled Snip filter definitions. */
export const SNIP_FILTERS_DIR = resolveBundledResourcePath("snip-filters");

/** Path to the bundled Catppuccin Mocha theme JSON. */
export const CATPPUCCIN_MOCHA_THEME_PATH = resolveBundledResourcePath("ui", "theme", "catppuccin-mocha.json");

/** Allowed Routing Intent values emitted by the router. */
export const ROUTING_INTENTS = ["INQUIRY", "IDEATION", "OPERATION", "QUICK_FIX", "FEATURE", "PROJECT"];

/** Allowed complexity values emitted by triage. */
export const COMPLEXITIES = ["LOW", "MEDIUM", "HIGH"];

/** Directory name where plan markdown files are stored. */
export const PLANS_DIR_NAME = "plans";

/** Directory name where canonical Work Record markdown files are stored. */
export const WORK_RECORDS_DIR_NAME = "docs/work-records";

/** User-facing label for the Work Records command group. */
export const WORK_RECORDS_COMMAND_LABEL = "wr";

/** Default bind host for the local read-only Plans Workspace. */
export const PLAN_UI_DEFAULT_HOST = "127.0.0.1";

/** Default Plans Workspace port. 0 asks the OS for an available random port. */
export const PLAN_UI_DEFAULT_PORT = 0;

/** Query parameter accepted for bootstrapping Workspace access. */
export const PLAN_UI_TOKEN_QUERY = "token";

/** Header accepted by read-only Workspace API endpoints. */
export const PLAN_UI_TOKEN_HEADER = "x-runwield-workspace-token";

/** User-facing label for the Plans Workspace subcommand. */
export const PLAN_UI_COMMAND_LABEL = "plans ui";

/** Directory name for project-local RunWield metadata. */
export const RUNWEILD_DIR_NAME = ".wld";

/** Durable execution worktree registry filename inside .wld/. */
export const WORKTREE_REGISTRY_FILE = "worktrees.json";

/** Best-effort lock filename for serialized worktree registry updates. */
export const WORKTREE_REGISTRY_LOCK_FILE = "worktrees.lock";

/** Git branch prefix for isolated execution worktrees. */
export const WORKTREE_BRANCH_PREFIX = "runwield/worktree/";

/** Path infix for adjacent isolated execution worktree directories. */
export const WORKTREE_PATH_PREFIX = "runwield-";

/**
 * Read an environment variable when permission is available.
 *
 * @param {string} name
 * @returns {string}
 */
function readOptionalEnv(name) {
    try {
        return Deno.env.get(name) || "";
    } catch {
        return "";
    }
}

export const HOME_DIR = readOptionalEnv("HOME");

/**
 * Canonical agent identifiers. Most values match an agent definition filename
 * (without the `.md` extension) in `src/agent-definitions/`. The display name
 * for standard agents is the `name:` field inside that file and must be loaded
 * via `getAgentDisplayName()` from `shared/session/agents.js` — never
 * hardcoded.
 *
 * `INIT` is a special pseudo-agent loaded from
 * `src/agent-definitions/workflow-prompts/init-agent-prompt.md` by path rather
 * than top-level agent discovery, so it does not appear in `/agent` listings.
 *
 * `SLICER` is a workflow-only pseudo-agent loaded from
 * `src/agent-definitions/workflow-prompts/slicer-prompt.md`, so it also does
 * not appear in `/agent` listings or return_to_router targets.
 *
 * `REVIEWER` is also workflow-only and is loaded from
 * `src/agent-definitions/workflow-prompts/reviewer-prompt.md` as a bare
 * prompt, without shared skills or extra tools.
 */
/** @type {Readonly<{ROUTER: string, GUIDE: string, OPERATOR: string, PLANNER: string, ARCHITECT: string, ENGINEER: string, REVIEWER: string, SLICER: string, TESTER: string, IDEATOR: string, RECORDER: string, INIT: string}>} */
export const AGENTS = Object.freeze({
    ROUTER: "router",
    GUIDE: "guide",
    OPERATOR: "operator",
    PLANNER: "planner",
    ARCHITECT: "architect",
    ENGINEER: "engineer",
    REVIEWER: "reviewer",
    SLICER: "slicer",
    TESTER: "tester",
    IDEATOR: "ideator",
    RECORDER: "recorder",
    INIT: "init",
});

/** Max concurrent agent tasks for PROJECT execution. */
export const MAX_PARALLEL_TASKS = 4;
