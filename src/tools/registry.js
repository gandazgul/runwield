/**
 * @module tools/registry
 * Shared tool policy constants for agent capability resolution.
 */

/**
 * Tools present for every user-facing Agent and protected from runtime narrowing.
 * Isolated Subagent definitions do not receive this list.
 *
 * @type {readonly string[]}
 */
export const UNIVERSAL_AGENT_TOOL_NAMES = Object.freeze([
    "set_session_name",
]);

/**
 * Tools protected from removal when they are present in an agent's bundled frontmatter.
 *
 * @type {readonly string[]}
 */
export const PROTECTED_TOOL_NAMES = Object.freeze([
    // memory
    "memory",
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
    // web access
    "web_search",
    "web_fetch",
    "web_code_search",
    "web_docs_search",
    // workflow tools
    "triage_report",
    "plan_written",
    "review_complete",
    "qa_checklist_generated",
    "task_completed",
    "user_interview",
    "work_record_search",
    "work_record_read",
]);
