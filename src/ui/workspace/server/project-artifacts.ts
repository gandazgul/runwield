// @ts-nocheck: server module uses the repository's JSDoc JavaScript style while keeping the TypeScript production extension.
/** @module ui/workspace/server/project-artifacts */

import { isAbsolute, join, relative } from "node:path";
import { listWorkRecords } from "../../../shared/work-records/store.js";
import { isCurrentWorkRecord, workRecordNotices } from "../../../shared/work-records/list.js";

export const PROJECT_ARTIFACT_TYPES = new Set(["work-record", "prd", "adr", "design-system", "domain-language"]);

/** @param {string} markdown @param {string} fallback */
function markdownTitle(markdown, fallback) {
    return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

/** @param {string} root @param {string} relativePath */
async function readSafeProjectMarkdown(root, relativePath) {
    if (
        !relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..") ||
        !relativePath.endsWith(".md")
    ) {
        throw new Error("Artifact identity is invalid.");
    }
    const canonicalRoot = await Deno.realPath(root);
    const path = join(root, relativePath);
    const canonicalPath = await Deno.realPath(path);
    const contained = relative(canonicalRoot, canonicalPath);
    if (isAbsolute(contained) || contained === ".." || contained.startsWith("../")) {
        throw new Error("Artifact identity leaves the Project.");
    }
    return await Deno.readTextFile(canonicalPath);
}

/** @param {string} type @param {string} sourceId */
function acceptedDocumentationPath(type, sourceId) {
    if (type === "prd" && /^docs\/prd\/(?:[^/]+\/)*[^/]+\.md$/.test(sourceId)) return true;
    if (type === "adr" && /^docs\/adr\/(?:[^/]+\/)*[^/]+\.md$/.test(sourceId)) return true;
    if (type === "design-system" && sourceId === "docs/design-system.md") return true;
    if (
        type === "domain-language" &&
        (sourceId === "docs/domain-language.md" || /^docs\/(?:[^/]+\/)+domain-language\.md$/.test(sourceId))
    ) return true;
    return false;
}

/** @param {string} root @param {string} type @param {string} sourceId */
export async function readProjectArtifact(root, type, sourceId) {
    if (!PROJECT_ARTIFACT_TYPES.has(type)) throw new Error("Artifact type is not supported.");
    if (type === "work-record") {
        const matches = (await listWorkRecords(root, { createDir: false })).filter((record) =>
            record.attrs.recordId.toLowerCase() === sourceId.toLowerCase()
        );
        if (matches.length > 1) {
            throw new Error("Duplicate Work Record identity. Repair the Project before opening it.");
        }
        if (matches.length === 0 || !isCurrentWorkRecord(matches[0])) throw new Error("Work Record not found.");
        const record = matches[0];
        const sourceLinks = record.attrs.provenance?.sourcePlans || [];
        return {
            kind: "work-record",
            title: record.title,
            markdown: record.markdown,
            path: record.relativePath,
            notices: [
                `Completion confidence: ${record.attrs.completionMode.replaceAll("_", " ")}.`,
                ...(sourceLinks.length ? [`Source Plans: ${sourceLinks.join(", ")}`] : []),
                ...workRecordNotices(record),
            ],
        };
    }
    if (!acceptedDocumentationPath(type, sourceId)) throw new Error("Artifact identity is not accepted for this type.");
    const markdown = await readSafeProjectMarkdown(root, sourceId);
    const labels = {
        prd: "PRD",
        adr: "ADR",
        "design-system": "Design System",
        "domain-language": "Domain Language",
    };
    return {
        kind: type,
        title: markdownTitle(markdown, labels[type] || "Document"),
        markdown,
        path: sourceId,
        notices: [],
    };
}
