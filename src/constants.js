/**
 * @module constants
 * Shared constants for Harness CLI orchestration.
 */

import { join } from "@std/path";

/** Current project root used by all command handlers and agent sessions. */
export const CWD = Deno.cwd();

/** Directory containing agent prompt markdown files. */
export const AGENTS_DIR = join(CWD, ".pi", "agents");

/**
 * Core system guidance prepended to every agent-specific prompt.
 * Keeps cross-agent behavior aligned with Harness expectations.
 */
export const CORE_SYSTEM_PROMPT = [
    "You are part of the Harness system — a plan-by-default coding harness.",
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
    RESUME: "resume",
    PLANS: "plans",
    HELP: "help",
});

/**
 * Reusable tool bundles for agent sessions.
 * Keeping these centralized avoids drift between commands.
 */
export const TOOLSETS = Object.freeze({
    ROUTER: ["read", "bash"],
    OPERATOR: ["read", "edit", "write", "bash"],
    PLANNING: ["read", "edit", "write", "bash"],
    ENGINEER: ["read", "edit", "write", "bash"],
    DOC_WRITER: ["read", "write", "bash"],
});
