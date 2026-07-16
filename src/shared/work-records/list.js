/**
 * @module shared/work-records/list
 * Filtering and CLI formatting for canonical Work Records.
 */

/** @param {import('./schema.js').WorkRecordResource} record */
export function isCurrentWorkRecord(record) {
    return record.attrs.status === "approved" && !record.attrs.archivedAt && !record.attrs.supersededBy;
}

/**
 * @param {import('./schema.js').WorkRecordResource[]} records
 * @param {{ includeAll?: boolean }} [options]
 */
export function filterWorkRecordsForList(records, options = {}) {
    const filtered = options.includeAll ? records : records.filter(isCurrentWorkRecord);
    return filtered.sort((a, b) =>
        b.attrs.createdAt.localeCompare(a.attrs.createdAt) || a.title.localeCompare(b.title)
    );
}

/** @param {import('./schema.js').WorkRecordResource} record */
export function workRecordNotices(record) {
    const notices = [];
    if (record.attrs.completionMode === "closed_without_verification") {
        notices.push("WARNING: RunWield verification was skipped.");
    }
    if (record.attrs.status !== "approved") notices.push(`WARNING: status is ${record.attrs.status}.`);
    if (record.attrs.archivedAt) notices.push(`WARNING: archived at ${record.attrs.archivedAt}.`);
    if (record.attrs.status === "superseded" || record.attrs.supersededBy) {
        notices.push(`WARNING: superseded${record.attrs.supersededBy ? ` by ${record.attrs.supersededBy}` : ""}.`);
    }
    return notices;
}

/** @param {import('./schema.js').WorkRecordResource} record */
export function formatWorkRecordListEntry(record) {
    const sourcePlans = record.attrs.provenance?.sourcePlans || [];
    const evidence = record.attrs.provenance?.evidence || [];
    const lines = [
        `- ${record.title}`,
        `  recordId: ${record.attrs.recordId}`,
        `  status: ${record.attrs.status}`,
        `  scope: ${record.attrs.scope}`,
        `  origin: ${record.attrs.origin}`,
        `  completionMode: ${record.attrs.completionMode}`,
    ];
    if (sourcePlans.length) lines.push(`  sourcePlans: ${sourcePlans.join(", ")}`);
    if (evidence.length) lines.push(`  evidence: ${evidence.map((entry) => entry.path).join(", ")}`);
    lines.push(`  path: ${record.relativePath}`);
    for (const notice of workRecordNotices(record)) lines.push(`  ${notice}`);
    return lines.join("\n");
}

/**
 * @param {import('./schema.js').WorkRecordResource[]} records
 * @param {{ includeAll?: boolean }} [options]
 */
export function formatWorkRecordList(records, options = {}) {
    const listed = filterWorkRecordsForList(records, options);
    if (!listed.length) {
        return options.includeAll ? "[RunWield] No Work Records found." : "[RunWield] No current Work Records found.";
    }
    const heading = options.includeAll ? "[RunWield] Work Records:" : "[RunWield] Current Work Records:";
    return [heading, "", ...listed.map(formatWorkRecordListEntry)].join("\n");
}
