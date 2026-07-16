/**
 * @module shared/work-records/markdown
 * Parse, validate, and format canonical Work Record markdown.
 */

import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import {
    isWorkRecordCompletionMode,
    isWorkRecordOrigin,
    isWorkRecordScope,
    isWorkRecordStatus,
    WORK_RECORD_FRONT_MATTER_KEYS,
    WORK_RECORD_KIND,
    WORK_RECORD_OPTIONAL_SECTION_TITLES,
} from "./schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} value */
function asTrimmedString(value) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Date) return value.toISOString();
    return "";
}

/** @param {unknown} value */
function stringList(value) {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(asTrimmedString).filter(Boolean);
    return list.length ? list : undefined;
}

/** @param {unknown} value */
function evidenceList(value) {
    if (!Array.isArray(value) || !value.length) return undefined;
    return value.map((item) => {
        if (!item || typeof item !== "object") return { path: "", note: "" };
        const record = /** @type {Record<string, unknown>} */ (item);
        return {
            path: asTrimmedString(record.path),
            note: asTrimmedString(record.note),
        };
    });
}

/** @param {unknown} value */
export function normalizeWorkRecordProvenance(value) {
    if (!value || typeof value !== "object") return undefined;
    const record = /** @type {Record<string, unknown>} */ (value);
    const sourcePlans = stringList(record.sourcePlans);
    const evidence = evidenceList(record.evidence);
    if (!sourcePlans && !evidence) return undefined;
    return {
        ...(sourcePlans ? { sourcePlans } : {}),
        ...(evidence ? { evidence } : {}),
    };
}

/** @param {Record<string, unknown>} attrs */
export function normalizeWorkRecordFrontMatter(attrs) {
    const provenance = normalizeWorkRecordProvenance(attrs.provenance);
    /** @type {import('./schema.js').WorkRecordFrontMatter} */
    const normalized = {
        kind: attrs.kind === WORK_RECORD_KIND ? WORK_RECORD_KIND : /** @type {any} */ (attrs.kind),
        recordId: asTrimmedString(attrs.recordId),
        status: /** @type {any} */ (asTrimmedString(attrs.status)),
        scope: /** @type {any} */ (asTrimmedString(attrs.scope)),
        origin: /** @type {any} */ (asTrimmedString(attrs.origin)),
        completionMode: /** @type {any} */ (asTrimmedString(attrs.completionMode)),
        createdAt: asTrimmedString(attrs.createdAt),
        ...(asTrimmedString(attrs.archivedAt) ? { archivedAt: asTrimmedString(attrs.archivedAt) } : {}),
        ...(Array.isArray(attrs.supersedes)
            ? { supersedes: stringList(attrs.supersedes) || [] }
            : asTrimmedString(attrs.supersedes)
            ? { supersedes: asTrimmedString(attrs.supersedes) }
            : {}),
        ...(asTrimmedString(attrs.supersededBy) ? { supersededBy: asTrimmedString(attrs.supersededBy) } : {}),
        ...(provenance ? { provenance } : {}),
    };
    return normalized;
}

/** @param {string} value */
function yamlScalar(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @param {string[]} lines
 * @param {string} key
 * @param {unknown} value
 */
function appendScalarOrList(lines, key, value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
        if (!value.length) return;
        lines.push(`${key}:`);
        for (const item of value) lines.push(`    - ${yamlScalar(String(item))}`);
        return;
    }
    if (String(value).trim()) lines.push(`${key}: ${yamlScalar(String(value))}`);
}

/**
 * @param {string[]} lines
 * @param {import('./schema.js').WorkRecordProvenance | undefined} provenance
 */
function appendProvenance(lines, provenance) {
    if (!provenance) return;
    const hasSourcePlans = Array.isArray(provenance.sourcePlans) && provenance.sourcePlans.length > 0;
    const hasEvidence = Array.isArray(provenance.evidence) && provenance.evidence.length > 0;
    if (!hasSourcePlans && !hasEvidence) return;
    lines.push(`${WORK_RECORD_FRONT_MATTER_KEYS.provenance}:`);
    if (hasSourcePlans) {
        lines.push("    sourcePlans:");
        for (const planId of provenance.sourcePlans || []) lines.push(`        - ${yamlScalar(planId)}`);
    }
    if (hasEvidence) {
        lines.push("    evidence:");
        for (const entry of provenance.evidence || []) {
            lines.push(`        - path: ${yamlScalar(entry.path)}`);
            lines.push(`          note: ${yamlScalar(entry.note)}`);
        }
    }
}

/** @param {import('./schema.js').WorkRecordFrontMatter} attrs */
export function formatWorkRecordFrontMatter(attrs) {
    const fm = /** @type {any} */ (normalizeWorkRecordFrontMatter(/** @type {Record<string, unknown>} */ (attrs)));
    const lines = ["---"];
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.kind, fm.kind);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.recordId, fm.recordId);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.status, fm.status);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.scope, fm.scope);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.origin, fm.origin);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.completionMode, fm.completionMode);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.createdAt, fm.createdAt);
    appendProvenance(lines, fm.provenance);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.archivedAt, fm.archivedAt);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.supersedes, fm.supersedes);
    appendScalarOrList(lines, WORK_RECORD_FRONT_MATTER_KEYS.supersededBy, fm.supersededBy);
    lines.push("---");
    return lines.join("\n");
}

/**
 * @param {import('./schema.js').WorkRecordFrontMatter} attrs
 * @param {string} body
 */
export function formatWorkRecordMarkdown(attrs, body) {
    return `${formatWorkRecordFrontMatter(attrs)}\n${String(body || "").replace(/^\s*/, "")}`;
}

/** @param {string} body */
export function extractWorkRecordSections(body) {
    const text = String(body || "").replace(/^\s+/, "");
    const titleMatch = text.match(/^#\s+(.+)\s*$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const headingMatches = [...text.matchAll(/^##\s+(.+)\s*$/gm)];
    /** @type {Record<string, string>} */
    const sections = {};
    for (let i = 0; i < headingMatches.length; i += 1) {
        const match = headingMatches[i];
        const name = match[1].trim();
        const start = (match.index || 0) + match[0].length;
        const end = i + 1 < headingMatches.length ? headingMatches[i + 1].index || text.length : text.length;
        sections[name] = text.slice(start, end).trim();
    }
    /** @type {Record<string, string>} */
    const optional = {};
    for (const title of WORK_RECORD_OPTIONAL_SECTION_TITLES) {
        if (sections[title]) optional[title] = sections[title];
    }
    return { title, summary: sections.Summary || "", optional };
}

/**
 * @param {import('./schema.js').WorkRecordFrontMatter} attrs
 * @param {string} body
 */
export function validateWorkRecord(attrs, body) {
    const errors = [];
    if (attrs.kind !== WORK_RECORD_KIND) errors.push('kind must be "work_record".');
    if (!UUID_RE.test(attrs.recordId || "")) errors.push("recordId must be a plain UUID string.");
    if (!isWorkRecordStatus(attrs.status)) errors.push(`status is invalid: ${attrs.status || "missing"}.`);
    if (!isWorkRecordScope(attrs.scope)) errors.push(`scope is invalid: ${attrs.scope || "missing"}.`);
    if (!isWorkRecordOrigin(attrs.origin)) errors.push(`origin is invalid: ${attrs.origin || "missing"}.`);
    if (!isWorkRecordCompletionMode(attrs.completionMode)) {
        errors.push(`completionMode is invalid: ${attrs.completionMode || "missing"}.`);
    }
    if (!attrs.createdAt) errors.push("createdAt is required.");
    if (attrs.origin === "internal" && !(attrs.provenance?.sourcePlans?.length)) {
        errors.push("provenance.sourcePlans is required for internal Work Records.");
    }
    if (attrs.provenance?.evidence) {
        for (const entry of attrs.provenance.evidence) {
            if (!entry.path || !entry.note) errors.push("provenance.evidence entries require path and note.");
        }
    }
    const sections = extractWorkRecordSections(body);
    if (!sections.title) errors.push("Markdown body must start with an H1 title.");
    if (!sections.summary) errors.push("Markdown body must include a non-empty ## Summary section.");
    if (errors.length) throw new Error(`Invalid Work Record: ${errors.join(" ")}`);
}

/**
 * @param {string} markdown
 * @param {{ path?: string, relativePath?: string }} [options]
 * @returns {import('./schema.js').WorkRecordResource}
 */
export function parseWorkRecordMarkdown(markdown, options = {}) {
    if (!hasFrontMatter(markdown)) throw new Error("Invalid Work Record: front matter is required.");
    const { attrs, body } = extractYaml(markdown);
    const normalized = normalizeWorkRecordFrontMatter(attrs);
    validateWorkRecord(normalized, body);
    const sections = extractWorkRecordSections(body);
    return {
        attrs: normalized,
        body,
        markdown,
        title: sections.title,
        summary: sections.summary,
        sections: sections.optional,
        path: options.path || "",
        relativePath: options.relativePath || "",
    };
}
