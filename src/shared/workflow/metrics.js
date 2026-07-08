/**
 * @module shared/workflow/metrics
 * Local-only workflow metrics recording helpers.
 */

import { dirname, isAbsolute, join } from "@std/path";
import { CWD, HOME_DIR, RUNWEILD_DIR_NAME } from "../../constants.js";
import { encodeCwdForSessionDir } from "../session/root-session.js";
import { getMergedCustomSetting } from "../settings.js";

/**
 * @typedef {"routing"|"planning"|"execution"|"validation"|"recovery"|"model_selection"|"tool_usage"} WorkflowMetricCategory
 */

/**
 * @typedef {string|number|boolean|null|Array<unknown>|Record<string, unknown>} SafeMetricDetails
 */

/**
 * @typedef {Object} WorkflowMetricRecord
 * @property {1} v
 * @property {string} ts
 * @property {WorkflowMetricCategory} category
 * @property {string} event
 * @property {string} cwdHash
 * @property {string} [sessionId]
 * @property {string} [planName]
 * @property {string} [agentName]
 * @property {SafeMetricDetails} [details]
 */

/**
 * @typedef {Object} WorkflowMetricsSettings
 * @property {boolean} [enabled]
 */

const METRICS_DIR_NAME = "workflow-metrics";
const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_LENGTH = 40;
const MAX_OBJECT_KEYS = 80;
const REDACTED = "[redacted]";
const PATH_REDACTED = "[path-redacted]";
const SENSITIVE_KEY_PATTERN =
    /(prompt|request|content|diff|output|apikey|api_key|token|secret|authorization|password|credential|privatekey|private_key)/i;
const PATH_KEY_PATTERN = /(^|_)(path|paths|cwd|dir|directory|file|files|root|worktreepath|executioncwd|projectroot)$/i;
const ALLOWED_PLAN_RELATIVE_PATH_KEYS = new Set(["affectedPaths"]);

/** @type {Map<string, string>} */
const cwdHashCache = new Map();
/** @type {Map<string, { subUsage: string, startedAt: number }>} */
const activeToolCalls = new Map();

/**
 * @param {unknown} setting
 * @returns {boolean}
 */
export function isWorkflowMetricsEnabled(setting = getMergedCustomSetting("workflowMetrics")) {
    if (setting === true) return true;
    if (setting === false || setting == null) return false;
    if (typeof setting === "object" && !Array.isArray(setting)) {
        return /** @type {{ enabled?: unknown }} */ (setting).enabled === true;
    }
    return false;
}

/**
 * @param {string} cwd
 * @param {string} [homeDir]
 * @returns {string}
 */
export function getWorkflowMetricsFilePath(cwd = CWD, homeDir = HOME_DIR || Deno.env.get("HOME") || "~") {
    return join(homeDir, RUNWEILD_DIR_NAME, METRICS_DIR_NAME, encodeCwdForSessionDir(cwd), "metrics.jsonl");
}

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function hashMetricCwd(value = CWD) {
    const cached = cwdHashCache.get(value);
    if (cached) return cached;
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    cwdHashCache.set(value, hash);
    return hash;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeAbsolutePath(value) {
    if (!value) return false;
    if (isAbsolute(value)) return true;
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("file://");
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRelativePath(value) {
    if (!value || looksLikeAbsolutePath(value)) return false;
    return value.startsWith("./") || value.startsWith("../") || value.includes("/") || value.includes("\\");
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {SafeMetricDetails | undefined}
 */
function sanitizeMetricValue(key, value) {
    if (value === undefined) return undefined;
    if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
    if (value == null) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        if (looksLikeAbsolutePath(value)) return PATH_REDACTED;
        if (PATH_KEY_PATTERN.test(key) && !ALLOWED_PLAN_RELATIVE_PATH_KEYS.has(key)) return PATH_REDACTED;
        if (looksLikeRelativePath(value) && !ALLOWED_PLAN_RELATIVE_PATH_KEYS.has(key)) return PATH_REDACTED;
        return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeMetricValue(key, item)).filter((item) =>
            item !== undefined
        );
    }
    if (isPlainObject(value)) {
        /** @type {{[key: string]: SafeMetricDetails}} */
        const output = {};
        for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
            const sanitized = sanitizeMetricValue(entryKey, entryValue);
            if (sanitized !== undefined) output[entryKey] = sanitized;
        }
        return output;
    }
    return undefined;
}

/**
 * @param {unknown} details
 * @returns {SafeMetricDetails | undefined}
 */
export function sanitizeMetricDetails(details) {
    return sanitizeMetricValue("details", details);
}

/**
 * @param {Object} metric
 * @param {WorkflowMetricCategory} metric.category
 * @param {string} metric.event
 * @param {string} [metric.sessionId]
 * @param {string} [metric.planName]
 * @param {string} [metric.agentName]
 * @param {unknown} [metric.details]
 * @param {{
 *   cwd?: string,
 *   homeDir?: string,
 *   settings?: unknown,
 *   now?: () => Date,
 *   mkdir?: typeof Deno.mkdir,
 *   writeTextFile?: typeof Deno.writeTextFile,
 *   getSetting?: () => unknown,
 * }} [deps]
 * @returns {Promise<WorkflowMetricRecord | null>}
 */
export async function recordWorkflowMetric(metric, deps = {}) {
    try {
        const setting = deps.settings !== undefined ? deps.settings : deps.getSetting ? deps.getSetting() : undefined;
        const resolvedSetting = setting !== undefined ? setting : getMergedCustomSetting("workflowMetrics");
        if (!isWorkflowMetricsEnabled(resolvedSetting)) return null;

        const cwd = deps.cwd || CWD;
        const filePath = getWorkflowMetricsFilePath(cwd, deps.homeDir);
        const now = deps.now || (() => new Date());
        /** @type {WorkflowMetricRecord} */
        const record = {
            v: 1,
            ts: now().toISOString(),
            category: metric.category,
            event: metric.event,
            cwdHash: await hashMetricCwd(cwd),
            ...(metric.sessionId ? { sessionId: metric.sessionId } : {}),
            ...(metric.planName ? { planName: metric.planName } : {}),
            ...(metric.agentName ? { agentName: metric.agentName } : {}),
            ...(metric.details !== undefined ? { details: sanitizeMetricDetails(metric.details) } : {}),
        };

        try {
            await (deps.mkdir || Deno.mkdir)(dirname(filePath), { recursive: true });
            await (deps.writeTextFile || Deno.writeTextFile)(filePath, `${JSON.stringify(record)}\n`, { append: true });
        } catch {
            return record;
        }
        return record;
    } catch {
        return null;
    }
}

/**
 * @param {string} command
 * @returns {string}
 */
function classifyBashCommand(command) {
    const trimmed = command.trim();
    if (/^(deno|npm|pnpm|yarn|bun|make|ninja|cargo|go|pytest|python\s+-m\s+pytest|mvn|gradle)\b/.test(trimmed)) {
        return /(test|check|lint|fmt|format|ci|build|pytest)/.test(trimmed) ? "validation_command" : "package_manager";
    }
    if (/^git\b/.test(trimmed)) return "git";
    if (/^(ls|find|grep|rg|cat|sed|awk|pwd|mkdir|rm|cp|mv|touch|chmod)\b/.test(trimmed)) return "filesystem";
    return "shell_other";
}

/**
 * @param {string} toolName
 * @param {unknown} args
 * @returns {string}
 */
export function classifyToolSubUsage(toolName, args = undefined) {
    if (toolName === "bash") {
        const command = isPlainObject(args) && typeof args.command === "string" ? args.command : "";
        return classifyBashCommand(command);
    }
    if (toolName === "code_search") return "search";
    if (toolName === "code_show") return "read";
    if (toolName === "code_outline") return "outline";
    if (toolName === "code_refs") return "refs";
    if (toolName === "code_impact") return "impact";
    if (toolName === "code_trace" || toolName === "code_investigate" || toolName === "code_impls") return "trace";
    if (toolName === "code_batch") return "read";
    if (toolName === "code_importers" || toolName === "code_structure") return "search";
    if (toolName === "memory_recall" || toolName === "memory_recall_global") return "read";
    if (toolName === "memory_store" || toolName === "memory_store_global") return "write";
    if (toolName === "memory_delete") return "delete";
    if (toolName === "read") return "read";
    if (toolName === "grep") return "search";
    if (toolName === "find" || toolName === "ls") return "list";
    if (toolName === "edit") return "edit";
    if (toolName === "multi_file_edit") return "multi_edit";
    if (toolName === "write") return "write";
    if (toolName === "triage_report") return "triage";
    if (toolName === "plan_written") return "plan_written";
    if (toolName === "task_completed") return "task_completed";
    if (toolName === "return_to_router") return "return_to_router";
    if (toolName === "user_interview") return "user_interview";
    if (/browser|agent-browser|screenshot|navigate|click|type/i.test(toolName)) {
        if (/screenshot/i.test(toolName)) return "screenshot";
        if (/navigate|open|goto/i.test(toolName)) return "navigate";
        if (/click|type|fill|press|select|interact/i.test(toolName)) return "interact";
        if (/inspect|snapshot|console|network/i.test(toolName)) return "inspect";
        return "browser_other";
    }
    return "other";
}

/**
 * @param {string} toolCallId
 * @param {string} toolName
 * @param {unknown} args
 * @param {string} [agentName]
 * @param {{ recordWorkflowMetric?: typeof recordWorkflowMetric, now?: () => number }} [deps]
 */
export function recordToolCallStarted(toolCallId, toolName, args, agentName, deps = {}) {
    const subUsage = classifyToolSubUsage(toolName, args);
    activeToolCalls.set(toolCallId, { subUsage, startedAt: deps.now ? deps.now() : Date.now() });
    void (deps.recordWorkflowMetric || recordWorkflowMetric)({
        category: "tool_usage",
        event: "tool_call_started",
        agentName,
        details: { toolName, subUsage },
    });
}

/**
 * @param {string} toolCallId
 * @param {string} toolName
 * @param {boolean} isError
 * @param {string} [agentName]
 * @param {{ recordWorkflowMetric?: typeof recordWorkflowMetric, now?: () => number }} [deps]
 */
export function recordToolCallFinished(toolCallId, toolName, isError, agentName, deps = {}) {
    const started = activeToolCalls.get(toolCallId);
    activeToolCalls.delete(toolCallId);
    const now = deps.now ? deps.now() : Date.now();
    void (deps.recordWorkflowMetric || recordWorkflowMetric)({
        category: "tool_usage",
        event: "tool_call_finished",
        agentName,
        details: {
            toolName,
            subUsage: started?.subUsage || classifyToolSubUsage(toolName),
            isError,
            durationMs: started ? now - started.startedAt : undefined,
        },
    });
}
