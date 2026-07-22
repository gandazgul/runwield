/**
 * @module shared/session/tool-event-title
 * Build the semantic tool title carried by both live and replayed Runtime
 * events. Consumers receive the same tool name and argument summary regardless
 * of whether the event came from an active turn or persisted history.
 */

/**
 * @typedef {Object} CodeBatchOperation
 * @property {string} op
 * @property {string} [target]
 * @property {string} [file]
 */

/**
 * @param {{ operations?: CodeBatchOperation[] } | undefined | null} args
 * @returns {string}
 */
function formatCodeBatchHeaderArgs(args) {
    if (!args || !Array.isArray(args.operations)) return "0 operations";

    const operations = args.operations;
    if (operations.length === 0) return "0 operations";

    const summaries = operations.slice(0, 3).map((operation) => {
        if (operation.op === "show") return `show ${operation.target || ""}`.trim();
        if (operation.op === "outline") return `outline ${operation.file || ""}`.trim();
        return operation.op || "operation";
    });
    const remainingCount = operations.length - summaries.length;
    if (remainingCount > 0) summaries.push(`+${remainingCount} more`);
    return summaries.join("; ");
}

/**
 * @param {string} toolName
 * @param {{ path?: string, file_path?: string, edits?: Array<{ path?: string, file_path?: string }> }} args
 * @returns {string | null}
 */
function getFilePathForTool(toolName, args) {
    if (!args) return null;

    switch (toolName) {
        case "read":
        case "edit":
        case "write":
        case "edit_docs":
        case "write_docs":
            return typeof args.path === "string"
                ? args.path
                : typeof args.file_path === "string"
                ? args.file_path
                : null;
        case "multi_file_edit": {
            if (!Array.isArray(args.edits) || args.edits.length === 0) return null;
            const paths = args.edits
                .map((edit) =>
                    typeof edit.path === "string"
                        ? edit.path
                        : typeof edit.file_path === "string"
                        ? edit.file_path
                        : null
                )
                .filter(Boolean);
            const uniquePaths = [...new Set(paths)];
            if (uniquePaths.length === 0) return null;
            if (uniquePaths.length === 1) return uniquePaths[0];
            return `${uniquePaths[0]} +${uniquePaths.length - 1} files`;
        }
        default:
            return null;
    }
}

/**
 * @param {string} toolName
 * @param {any} args
 * @returns {string}
 */
function formatToolEventTitle(toolName, args) {
    const filePath = getFilePathForTool(toolName, args);
    let headerArgs = "";
    if (filePath) headerArgs = filePath;
    else if (toolName === "bash") headerArgs = args?.command || "";
    else if (toolName === "grep") {
        const path = Array.isArray(args?.path) ? args.path.join(" ") : args?.path || ".";
        headerArgs = `${args?.pattern} in ${path}`;
    } else if (toolName === "find") {
        headerArgs = `${args?.pattern} in ${args?.path || "."}`;
    } else if (toolName === "ls") {
        headerArgs = args?.path || ".";
    } else if (toolName === "code_search") {
        const query = args?.query || "";
        headerArgs = args?.textSearch ? `${query} (text)` : query;
    } else if (toolName === "code_show") {
        headerArgs = args?.target || "";
    } else if (toolName === "code_outline") {
        headerArgs = args?.file || "";
    } else if (toolName === "code_batch") {
        headerArgs = formatCodeBatchHeaderArgs(args);
    } else if (
        toolName === "code_refs" || toolName === "code_impact" || toolName === "code_trace" ||
        toolName === "code_investigate" || toolName === "code_impls"
    ) {
        headerArgs = args?.symbol || "";
    } else if (toolName === "code_importers") {
        headerArgs = args?.target || "";
    } else if (toolName === "code_structure" || toolName === "code_codebase_info") {
        headerArgs = "";
    } else if (toolName === "plan_written") {
        const planName = String(args?.planName || "").replace(/\.md$/i, "").trim();
        headerArgs = planName ? `plans/${planName}.md` : "";
    } else if (toolName === "memory_recall" || toolName === "memory_recall_global") {
        headerArgs = args?.query || "";
    } else if (toolName === "memory_store" || toolName === "memory_store_global") {
        const content = args?.content || "";
        headerArgs = content.length > 80 ? content.slice(0, 77) + "..." : content;
    } else if (toolName === "memory_delete") {
        headerArgs = `id: ${args?.id}`;
    } else if (toolName === "work_record_search") {
        headerArgs = args?.query || "";
    } else if (toolName === "work_record_read") {
        headerArgs = args?.recordId || "";
    } else if (toolName === "task_completed") {
        const message = args?.message || "";
        headerArgs = message.length > 60 ? message.slice(0, 57) + "..." : message;
    } else if (toolName === "return_to_router") {
        headerArgs = "to router";
    } else if (toolName === "delegate_agent") {
        const brief = String(args?.brief || "").trim();
        const preview = brief.length > 60 ? brief.slice(0, 57) + "..." : brief;
        headerArgs = `${args?.mode || "read"}${preview ? `: ${preview}` : ""}`;
    }

    return toolName === "bash" ? `$ ${headerArgs}`.trim() : `${toolName} ${headerArgs}`.trim();
}

/**
 * @typedef {"read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other"} RuntimeToolKind
 */

/**
 * Build the complete stable identity consumers use to present a tool call.
 * @param {string} toolName
 * @param {any} args
 * @returns {{ toolName: string, title: string, kind: RuntimeToolKind }}
 */
export function describeRuntimeTool(toolName, args) {
    /** @type {RuntimeToolKind} */
    let kind = "other";
    if (toolName === "read" || toolName === "ls") kind = "read";
    else if (
        toolName === "edit" || toolName === "write" || toolName === "multi_file_edit" ||
        toolName === "edit_docs" || toolName === "write_docs"
    ) kind = "edit";
    else if (
        toolName === "grep" || toolName === "find" || toolName === "code_search" || toolName === "code_refs" ||
        toolName === "code_impact" || toolName === "code_trace" || toolName === "code_impls" ||
        toolName === "code_importers" || toolName === "code_structure" || toolName === "code_codebase_info" ||
        toolName === "memory_recall" || toolName === "memory_recall_global" || toolName === "work_record_search"
    ) kind = "search";
    else if (toolName === "work_record_read") kind = "read";
    else if (toolName === "bash") kind = "execute";
    else if (toolName === "code_investigate" || toolName === "delegate_agent") kind = "think";
    else if (toolName === "return_to_router") kind = "switch_mode";
    return { toolName, title: formatToolEventTitle(toolName, args), kind };
}
