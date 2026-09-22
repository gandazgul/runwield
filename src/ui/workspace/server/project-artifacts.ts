// @ts-nocheck: server module uses the repository's JSDoc JavaScript style while keeping the TypeScript production extension.
/** @module ui/workspace/server/project-artifacts */

import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { listControllerDocumentWorktrees } from "../../../shared/workflow/controller-registry.ts";
import { getWorkRecordsDir, listWorkRecords } from "../../../shared/work-records/store.js";
import { isCurrentWorkRecord, workRecordNotices } from "../../../shared/work-records/list.js";

export const PROJECT_ARTIFACT_TYPES = new Set(["work-record", "prd", "adr", "design-system", "domain-language"]);

/** @param {string} markdown @param {string} fallback */
function markdownTitle(markdown, fallback) {
    return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

/** @param {string} root @param {string} path */
export async function assertContainedProjectPath(root, path) {
    const canonicalRoot = await Deno.realPath(root);
    const canonicalPath = await Deno.realPath(path);
    const contained = relative(canonicalRoot, canonicalPath);
    if (isAbsolute(contained) || contained === ".." || contained.startsWith("../")) {
        throw new Error("Artifact identity leaves the Project.");
    }
    return canonicalPath;
}

/** @param {string} root @param {string} path @param {string} planName */
export async function assertAuthorizedPlanPath(root, path, planName) {
    try {
        return await assertContainedProjectPath(root, path);
    } catch (containmentError) {
        const canonicalPath = await Deno.realPath(path);
        const attempts = await listControllerDocumentWorktrees(root);
        for (const attempt of attempts) {
            if (attempt.planName !== planName) continue;
            const expectedPath = join(attempt.path, "docs", "plans", `${planName}.md`);
            try {
                const containedPath = await assertContainedProjectPath(attempt.path, expectedPath);
                if (containedPath === canonicalPath) return canonicalPath;
            } catch (error) {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
        }
        throw containmentError;
    }
}

/** @param {string} root @param {string} relativePath */
export async function readSafeProjectMarkdown(root, relativePath) {
    if (
        !relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..") ||
        !relativePath.endsWith(".md")
    ) {
        throw new Error("Artifact identity is invalid.");
    }
    const canonicalPath = await assertContainedProjectPath(root, join(root, relativePath));
    return await Deno.readTextFile(canonicalPath);
}

/** @param {string} root */
export async function domainLanguagePaths(root) {
    const mapRelativePath = "docs/domain-language-map.md";
    const mapPath = join(root, mapRelativePath);
    try {
        const map = await readSafeProjectMarkdown(root, mapRelativePath);
        const paths = [];
        for (const match of map.matchAll(/\]\(([^)]+domain-language\.md)(?:#[^)]+)?\)/g)) {
            const target = match[1];
            const relativePath = relative(root, resolve(dirname(mapPath), target)).replaceAll("\\", "/");
            if (relativePath === mapRelativePath || relativePath.startsWith("../")) continue;
            paths.push(relativePath);
        }
        return [...new Set(paths)];
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        try {
            await readSafeProjectMarkdown(root, "docs/domain-language.md");
            return ["docs/domain-language.md"];
        } catch (nested) {
            if (nested instanceof Deno.errors.NotFound) return [];
            throw nested;
        }
    }
}

/** @param {string} type @param {string} sourceId */
function acceptedDocumentationPath(type, sourceId) {
    if (type === "prd" && /^docs\/prd\/(?:[^/]+\/)*[^/]+\.md$/.test(sourceId)) return true;
    if (type === "adr" && /^docs\/adr\/(?:[^/]+\/)*[^/]+\.md$/.test(sourceId)) return true;
    if (type === "design-system" && sourceId === "docs/design-system.md") return true;
    return false;
}

/** @param {string} root */
async function currentWorkRecords(root) {
    try {
        await assertContainedProjectPath(root, getWorkRecordsDir(root));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
    const records = await listWorkRecords(root, { createDir: false });
    for (const record of records) await assertContainedProjectPath(root, record.path);
    return records;
}

/** @param {string} root @param {string} type @param {string} sourceId */
export async function readProjectArtifact(root, type, sourceId) {
    if (!PROJECT_ARTIFACT_TYPES.has(type)) throw new Error("Artifact type is not supported.");
    if (type === "work-record") {
        const matches = (await currentWorkRecords(root)).filter((record) =>
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
            sourceLinks,
            notices: [
                `Completion confidence: ${record.attrs.completionMode.replaceAll("_", " ")}.`,
                ...workRecordNotices(record),
            ],
        };
    }
    if (type === "domain-language") {
        if (!(await domainLanguagePaths(root)).includes(sourceId)) {
            throw new Error("Domain Language document is not in the current map.");
        }
    } else if (!acceptedDocumentationPath(type, sourceId)) {
        throw new Error("Artifact identity is not accepted for this type.");
    }
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
