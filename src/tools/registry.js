/**
 * @module tools/registry
 * Shared tool policy constants for agent capability resolution.
 */

/**
 * Tools protected from removal when they are present in an agent's bundled frontmatter.
 *
 * @type {readonly string[]}
 */
export const PROTECTED_TOOL_NAMES = Object.freeze([
    // memory
    "memory_recall",
    "memory_recall_global",
    "memory_store",
    "memory_store_global",
    "memory_delete",
    // codebase exploration
    "code_search",
    "code_show",
    "code_outline",
    "code_batch",
    "code_refs",
    "code_impact",
    "code_trace",
    "code_investigate",
    "code_structure",
    "code_impls",
    "code_importers",
    // workflow tools
    "triage_report",
    "plan_written",
    "task_completed",
    "return_to_router",
    "user_interview",
]);
