// @ts-nocheck: server module uses the repository's JSDoc JavaScript style while keeping the TypeScript production extension.
/** @module ui/workspace/server/workspace-search */

import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getHomeDir } from "../../../constants.js";
import { findPlanEvidenceById, listPlanResources } from "../../../plan-store.js";
import { listWorkRecords } from "../../../shared/work-records/store.js";
import { isCurrentWorkRecord, workRecordNotices } from "../../../shared/work-records/list.js";
import { projectAggregateTranscript } from "../../../shared/session/session-transcript-manifest.ts";
import { getWorkspaceSearchRefreshMarker } from "../../../shared/workspace-search-refresh.ts";

const SEARCH_SCHEMA_VERSION = 1;
export const WORKSPACE_SEARCH_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CANDIDATE_LIMIT = 500;
const SUPPORTED_TYPES = new Set(["plan", "work-record", "prd", "adr", "design-system", "domain-language", "session"]);

/** @typedef {{ projectId: string, projectName: string, type: string, sourceId: string, relativePath: string, title: string, headings: string, body: string, revision: string, updatedAt: string, metadata: string }} SearchDocument */

/** @param {string} text */
async function fingerprint(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} markdown */
function markdownFacts(markdown) {
    const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
    return { title: headings[0] || "Untitled", headings: headings.join("\n") };
}

/** @param {string} root @param {string} path */
async function readContainedMarkdown(root, path) {
    const canonicalRoot = await Deno.realPath(root);
    const canonicalPath = await Deno.realPath(path);
    const contained = relative(canonicalRoot, canonicalPath);
    if (isAbsolute(contained) || contained === ".." || contained.startsWith("../")) {
        throw new Error("Document path leaves the registered Project.");
    }
    if (!canonicalPath.endsWith(".md")) throw new Error("Only Markdown documents are supported.");
    return await Deno.readTextFile(canonicalPath);
}

/** @param {string} root @param {string} directory @param {string} type */
async function scanMarkdownDirectory(root, directory, type) {
    /** @type {SearchDocument[]} */
    const documents = [];
    try {
        const pending = [directory];
        while (pending.length) {
            const current = pending.pop();
            for await (const entry of Deno.readDir(join(root, current))) {
                const relativePath = `${current}/${entry.name}`.replaceAll("\\", "/");
                if (entry.isDirectory) {
                    pending.push(relativePath);
                    continue;
                }
                if (!entry.isFile || !entry.name.endsWith(".md")) continue;
                const markdown = await readContainedMarkdown(root, join(root, relativePath));
                const facts = markdownFacts(markdown);
                const stat = await Deno.stat(join(root, relativePath));
                documents.push({
                    projectId: "",
                    projectName: "",
                    type,
                    sourceId: relativePath,
                    relativePath,
                    title: facts.title,
                    headings: facts.headings,
                    body: markdown,
                    revision: await fingerprint(markdown),
                    updatedAt: stat.mtime?.toISOString() || "",
                    metadata: "{}",
                });
            }
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
    return documents;
}

/** @param {string} root */
async function domainLanguagePaths(root) {
    const mapPath = join(root, "docs", "domain-language-map.md");
    try {
        const map = await readContainedMarkdown(root, mapPath);
        const paths = [];
        for (const match of map.matchAll(/\]\(([^)]+domain-language\.md)\)/g)) {
            const target = match[1].split("#")[0];
            const relativePath = relative(root, resolve(dirname(mapPath), target)).replaceAll("\\", "/");
            if (relativePath === "docs/domain-language-map.md" || relativePath.startsWith("../")) continue;
            paths.push(relativePath);
        }
        return [...new Set(paths)];
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        try {
            await Deno.stat(join(root, "docs", "domain-language.md"));
            return ["docs/domain-language.md"];
        } catch (nested) {
            if (nested instanceof Deno.errors.NotFound) return [];
            throw nested;
        }
    }
}

/** @param {string} root @param {string} relativePath @param {string} type */
async function documentationRecord(root, relativePath, type) {
    const markdown = await readContainedMarkdown(root, join(root, relativePath));
    const facts = markdownFacts(markdown);
    const stat = await Deno.stat(join(root, relativePath));
    return {
        projectId: "",
        projectName: "",
        type,
        sourceId: relativePath,
        relativePath,
        title: facts.title,
        headings: facts.headings,
        body: markdown,
        revision: await fingerprint(markdown),
        updatedAt: stat.mtime?.toISOString() || "",
        metadata: "{}",
    };
}

/** @param {string} root */
async function scanProjectDocuments(root) {
    /** @type {SearchDocument[]} */
    const documents = [];
    const plans = await listPlanResources(root, { backfillMissing: false });
    for (const plan of plans) {
        if (!plan.planId) {
            throw new Error("Plan reader found a Plan without durable identity. Repair the Plan before indexing.");
        }
        const facts = markdownFacts(plan.markdown);
        documents.push({
            projectId: "",
            projectName: "",
            type: "plan",
            sourceId: plan.planId,
            relativePath: plan.relativePath,
            title: plan.attrs.title || facts.title || plan.planName,
            headings: facts.headings,
            body: plan.markdown,
            revision: plan.revision,
            updatedAt: String(plan.attrs.updatedAt || plan.attrs.createdAt || ""),
            metadata: JSON.stringify({ status: plan.attrs.status || "" }),
        });
    }

    const records = await listWorkRecords(root, { createDir: false });
    const recordIds = new Map();
    for (const record of records) {
        const id = record.attrs.recordId.toLowerCase();
        recordIds.set(id, (recordIds.get(id) || 0) + 1);
    }
    if ([...recordIds.values()].some((count) => count > 1)) {
        throw new Error("Work Record reader found duplicate durable identities. Repair the records before indexing.");
    }
    for (const record of records) {
        if (!isCurrentWorkRecord(record)) continue;
        const facts = markdownFacts(record.markdown);
        documents.push({
            projectId: "",
            projectName: "",
            type: "work-record",
            sourceId: record.attrs.recordId,
            relativePath: record.relativePath,
            title: record.title,
            headings: facts.headings,
            body: record.markdown,
            revision: await fingerprint(record.markdown),
            updatedAt: record.attrs.createdAt,
            metadata: JSON.stringify({
                summary: record.summary,
                completionMode: record.attrs.completionMode,
                sourceLinks: record.attrs.provenance?.sourcePlans || [],
                notices: workRecordNotices(record),
            }),
        });
    }

    documents.push(...await scanMarkdownDirectory(root, "docs/prd", "prd"));
    documents.push(...await scanMarkdownDirectory(root, "docs/adr", "adr"));
    try {
        documents.push(await documentationRecord(root, "docs/design-system.md", "design-system"));
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    for (const relativePath of await domainLanguagePaths(root)) {
        documents.push(await documentationRecord(root, relativePath, "domain-language"));
    }
    return documents;
}

/** @param {import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore} store @param {string} projectId @param {string} root */
async function scanSessionDocuments(store, projectId, root) {
    const documents = [];
    let page = 0;
    while (true) {
        const listed = await store.listProjectSessions(projectId, { catalog: false, page, pageSize: 100 });
        for (const session of listed.sessions) {
            const control = store.inspectSessionActivation(session.runwieldSessionId);
            const generation = control.generation;
            let firstMessage = "";
            let committedName = session.displayName || "";
            if (generation) {
                const projection = await projectAggregateTranscript({
                    runwieldSessionId: session.runwieldSessionId,
                    cwd: root,
                    generation,
                    segments: store.listSessionTranscriptSegments(session.runwieldSessionId),
                    limit: 1,
                });
                if (!projection.ok) continue;
                firstMessage = typeof projection.snapshot.firstMessage === "string"
                    ? projection.snapshot.firstMessage
                    : "";
                if (typeof projection.snapshot.name === "string" && projection.snapshot.name.trim()) {
                    committedName = projection.snapshot.name.trim();
                }
            }
            if (!committedName.trim() && !firstMessage.trim()) continue;
            const title = committedName.trim() || firstMessage.trim().slice(0, 100);
            const body = firstMessage.trim();
            documents.push({
                projectId: "",
                projectName: "",
                type: "session",
                sourceId: session.runwieldSessionId,
                relativePath: "",
                title,
                headings: "",
                body,
                revision: await fingerprint(`${title}\n${body}\n${generation?.digestHex || ""}`),
                updatedAt: generation?.committedAt || session.headerTimestamp || session.lastCatalogedAt || "",
                metadata: "{}",
            });
        }
        if (!listed.hasNext) break;
        page += 1;
    }
    return documents;
}

/** @param {string} dbPath */
function initializeDatabase(dbPath) {
    Deno.mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 5000");
    const version = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
    if (version > SEARCH_SCHEMA_VERSION) {
        db.close();
        throw new Error(`Workspace search schema ${version} is newer than supported schema ${SEARCH_SCHEMA_VERSION}.`);
    }
    db.exec(`
        CREATE TABLE IF NOT EXISTS search_documents (
            identity TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            project_name TEXT NOT NULL,
            content_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            title TEXT NOT NULL,
            headings TEXT NOT NULL,
            body TEXT NOT NULL,
            revision TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            metadata TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
            identity UNINDEXED, title, headings, body, tokenize='unicode61'
        );
        PRAGMA user_version = ${SEARCH_SCHEMA_VERSION};
    `);
    return db;
}

/** @param {string} path */
function openSearchDatabase(path) {
    try {
        return initializeDatabase(path);
    } catch (error) {
        if (path === ":memory:") throw error;
        const quarantine = `${path}.quarantine-${Date.now()}`;
        try {
            Deno.renameSync(path, quarantine);
            for (const suffix of ["-wal", "-shm"]) {
                try {
                    Deno.renameSync(`${path}${suffix}`, `${quarantine}${suffix}`);
                } catch (sidecarError) {
                    if (!(sidecarError instanceof Deno.errors.NotFound)) throw sidecarError;
                }
            }
        } catch (renameError) {
            if (!(renameError instanceof Deno.errors.NotFound)) throw error;
        }
        return initializeDatabase(path);
    }
}

/** @param {string} value */
function browserSourceKey(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} value */
function ftsQuery(value) {
    const tokens = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
    return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

/** @param {SearchDocument} document @param {string} query */
function documentMatches(document, query) {
    const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
    const searchable = `${document.title}\n${document.headings}\n${document.body}`.toLocaleLowerCase();
    return tokens.length > 0 && tokens.every((token) => searchable.includes(token));
}

/** @param {SearchDocument} document @param {string} query */
function matchRank(document, query) {
    const needle = query.trim().toLocaleLowerCase();
    const title = document.title.toLocaleLowerCase();
    if (title === needle) return 0;
    if (title.includes(needle) || document.headings.toLocaleLowerCase().includes(needle)) return 1;
    return 2;
}

/** @param {string} root @param {Record<string, string>} row */
async function hydrateCandidate(root, row, store) {
    if (row.content_type === "session") {
        const session = store.getSessionById(row.source_id, row.project_id);
        if (!session) throw new Error("Session not found.");
        const documents = await scanSessionDocuments(store, row.project_id, root);
        const document = documents.find((candidate) => candidate.sourceId === row.source_id);
        if (!document) throw new Error("Session evidence is unavailable.");
        return { ...row, title: document.title, headings: "", body: document.body, revision: document.revision };
    }
    if (row.content_type === "plan") {
        const plan = await findPlanEvidenceById(root, row.source_id);
        const facts = markdownFacts(plan.markdown);
        return {
            ...row,
            title: plan.attrs.title || facts.title || plan.planName,
            headings: facts.headings,
            body: plan.markdown,
            revision: plan.revision,
        };
    }
    if (row.content_type === "work-record") {
        const records = (await listWorkRecords(root, { createDir: false })).filter((record) =>
            record.attrs.recordId.toLowerCase() === row.source_id.toLowerCase()
        );
        if (records.length !== 1 || !isCurrentWorkRecord(records[0])) throw new Error("Work Record is not current.");
        const record = records[0];
        const facts = markdownFacts(record.markdown);
        return {
            ...row,
            title: record.title,
            headings: facts.headings,
            body: record.markdown,
            revision: await fingerprint(record.markdown),
        };
    }
    const markdown = await readContainedMarkdown(root, join(root, row.relative_path));
    const facts = markdownFacts(markdown);
    return {
        ...row,
        title: facts.title,
        headings: facts.headings,
        body: markdown,
        revision: await fingerprint(markdown),
    };
}

/** @param {{ store: import('../../../shared/owner-coordination/index.js').OwnerCoordinationStore, dbPath?: string, scanIntervalMs?: number }} options */
export function createWorkspaceSearchService(options) {
    const dbPath = options.dbPath ||
        (options.store.path === ":memory:" ? ":memory:" : join(
            dirname(options.store.path || join(getHomeDir(), ".wld", "owner.sqlite3")),
            "workspace-search.sqlite3",
        ));
    const db = openSearchDatabase(dbPath);
    const scanIntervalMs = Math.min(
        options.scanIntervalMs || WORKSPACE_SEARCH_SCAN_INTERVAL_MS,
        WORKSPACE_SEARCH_SCAN_INTERVAL_MS,
    );
    let closed = false;
    let scanPromise = null;
    let scanTimer = null;
    let refreshTimer = null;
    const observedRefreshMarkers = new Map();
    /** @type {Map<string, { state: string, reader?: string, message?: string }>} */
    const projectStates = new Map();

    async function scan() {
        if (closed) return;
        if (scanPromise) return await scanPromise;
        scanPromise = (async () => {
            for (const project of options.store.listProjects()) {
                if (project.lifecycle !== "enabled") {
                    db.prepare("DELETE FROM search_documents WHERE project_id = ?").run(project.projectId);
                    db.prepare(
                        "DELETE FROM search_documents_fts WHERE identity NOT IN (SELECT identity FROM search_documents)",
                    ).run();
                    projectStates.delete(project.projectId);
                    continue;
                }
                projectStates.set(project.projectId, { state: "indexing" });
                try {
                    const root = options.store.requireEnabledProjectRoot(project.projectId);
                    const documents = await scanProjectDocuments(root);
                    documents.push(...await scanSessionDocuments(options.store, project.projectId, root));
                    db.exec("BEGIN IMMEDIATE");
                    try {
                        const oldIdentities = db.prepare("SELECT identity FROM search_documents WHERE project_id = ?")
                            .all(project.projectId)
                            .map((row) => String(row.identity));
                        for (const identity of oldIdentities) {
                            db.prepare("DELETE FROM search_documents_fts WHERE identity = ?").run(identity);
                        }
                        db.prepare("DELETE FROM search_documents WHERE project_id = ?").run(project.projectId);
                        const insert = db.prepare(
                            "INSERT INTO search_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        );
                        const insertFts = db.prepare(
                            "INSERT INTO search_documents_fts(identity, title, headings, body) VALUES (?, ?, ?, ?)",
                        );
                        for (const document of documents) {
                            const identity = `${project.projectId}:${document.type}:${document.sourceId}`;
                            insert.run(
                                identity,
                                project.projectId,
                                project.displayName,
                                document.type,
                                document.sourceId,
                                document.relativePath,
                                document.title,
                                document.headings,
                                document.body,
                                document.revision,
                                document.updatedAt,
                                document.metadata,
                            );
                            insertFts.run(identity, document.title, document.headings, document.body);
                        }
                        db.exec("COMMIT");
                    } catch (error) {
                        db.exec("ROLLBACK");
                        throw error;
                    }
                    projectStates.set(project.projectId, { state: "ready" });
                } catch (error) {
                    projectStates.set(project.projectId, {
                        state: "failed",
                        reader: "Project knowledge",
                        message: error instanceof Error && !/[/\\]/.test(error.message)
                            ? error.message
                            : "Project indexing failed.",
                    });
                }
            }
        })().finally(() => {
            scanPromise = null;
            if (!closed) {
                scanTimer = setTimeout(scan, scanIntervalMs);
                Deno.unrefTimer(scanTimer);
            }
        });
        return await scanPromise;
    }

    async function checkRefreshRequests() {
        if (closed || scanPromise) return;
        for (const project of options.store.listProjects()) {
            if (project.lifecycle !== "enabled") continue;
            try {
                const root = options.store.requireEnabledProjectRoot(project.projectId);
                const stat = await Deno.stat(await getWorkspaceSearchRefreshMarker(root));
                const revision = stat.mtime?.getTime() || stat.size;
                if (observedRefreshMarkers.get(project.projectId) === revision) continue;
                observedRefreshMarkers.set(project.projectId, revision);
                await refresh();
                return;
            } catch (error) {
                if (!(error instanceof Deno.errors.NotFound)) continue;
            }
        }
    }

    async function search(input) {
        const query = String(input.query || "").trim();
        const page = Math.max(1, Number(input.page) || 1);
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize) || DEFAULT_PAGE_SIZE));
        const projectId = String(input.projectId || "");
        const contentType = String(input.contentType || "");
        if (!query) {
            return {
                query,
                page,
                pageSize,
                total: 0,
                results: [],
                projects: projectOptions(),
                contentTypes: [...SUPPORTED_TYPES],
                states: stateValues(),
            };
        }
        if (contentType && !SUPPORTED_TYPES.has(contentType)) throw new Error("Unsupported content type filter.");
        const match = ftsQuery(query);
        if (!match) {
            return {
                query,
                page,
                pageSize,
                total: 0,
                results: [],
                projects: projectOptions(),
                contentTypes: [...SUPPORTED_TYPES],
                states: stateValues(),
            };
        }
        const filters = ["search_documents_fts MATCH ?"];
        const values = [match];
        if (projectId) {
            filters.push("documents.project_id = ?");
            values.push(projectId);
        }
        if (contentType) {
            filters.push("documents.content_type = ?");
            values.push(contentType);
        }
        const rows = db.prepare(
            `SELECT documents.* FROM search_documents_fts JOIN search_documents documents USING(identity) WHERE ${
                filters.join(" AND ")
            } LIMIT ${CANDIDATE_LIMIT}`,
        ).all(...values);
        const valid = [];
        for (const row of rows) {
            try {
                const root = options.store.requireEnabledProjectRoot(String(row.project_id));
                const hydrated = await hydrateCandidate(root, row, options.store);
                const candidate = /** @type {SearchDocument} */ ({
                    projectId: String(row.project_id),
                    projectName: String(row.project_name),
                    type: String(row.content_type),
                    sourceId: String(row.source_id),
                    relativePath: String(row.relative_path),
                    title: String(hydrated.title),
                    headings: String(hydrated.headings),
                    body: String(hydrated.body),
                    revision: String(hydrated.revision),
                    updatedAt: String(row.updated_at),
                    metadata: String(row.metadata),
                });
                if (!documentMatches(candidate, query)) continue;
                const rank = matchRank(candidate, query);
                const metadata = JSON.parse(candidate.metadata || "{}");
                valid.push({
                    id: `${candidate.projectId}:${candidate.type}:${candidate.sourceId}`,
                    projectId: candidate.projectId,
                    projectName: candidate.projectName,
                    contentType: candidate.type,
                    sourceId: candidate.sourceId,
                    title: candidate.title,
                    snippet: candidate.body.replace(/^---[\s\S]*?---\s*/, "").replace(/[#*_`>\[\]()]/g, " ").replace(
                        /\s+/g,
                        " ",
                    ).trim().slice(0, 220),
                    revision: candidate.revision,
                    freshness: candidate.revision === String(row.revision) ? "current" : "changed",
                    destination: candidate.type === "plan"
                        ? `/projects/${encodeURIComponent(candidate.projectId)}/plans/${
                            encodeURIComponent(candidate.sourceId)
                        }`
                        : candidate.type === "session"
                        ? `/projects/${encodeURIComponent(candidate.projectId)}/sessions/${
                            encodeURIComponent(candidate.sourceId)
                        }`
                        : `/projects/${encodeURIComponent(candidate.projectId)}/artifacts/${
                            encodeURIComponent(candidate.type)
                        }/${browserSourceKey(candidate.sourceId)}`,
                    rank,
                    updatedAt: candidate.updatedAt,
                    ...metadata,
                });
            } catch {
                // Canonical evidence changed or disappeared. A stale candidate never reaches the browser.
            }
        }
        valid.sort((a, b) => a.rank - b.rank || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const start = (page - 1) * pageSize;
        return {
            query,
            page,
            pageSize,
            total: valid.length,
            results: valid.slice(start, start + pageSize),
            projects: projectOptions(),
            contentTypes: [...SUPPORTED_TYPES],
            states: stateValues(),
        };
    }

    function projectOptions() {
        return options.store.listProjects().filter((project) => project.lifecycle === "enabled")
            .map((project) => ({ projectId: project.projectId, name: project.displayName }));
    }
    function stateValues() {
        return [...projectStates.entries()].map(([projectId, state]) => ({ projectId, ...state }));
    }
    function refresh() {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = null;
        return scan();
    }
    async function close() {
        if (closed) return;
        closed = true;
        if (scanTimer) clearTimeout(scanTimer);
        if (refreshTimer) clearInterval(refreshTimer);
        if (scanPromise) await scanPromise;
        db.close();
    }

    refreshTimer = setInterval(() => checkRefreshRequests().catch(() => {}), 1_000);
    Deno.unrefTimer(refreshTimer);
    queueMicrotask(() => scan().catch(() => {}));
    return { search, refresh, close, dbPath, scanIntervalMs };
}
