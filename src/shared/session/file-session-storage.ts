/**
 * @module shared/session/file-session-storage
 * Durable paths, Project identity, and atomic manifest persistence.
 */

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { createHash } from "node:crypto";
import { encodeCwdForSessionDir } from "./root-session.js";
import type { FileSessionManifest, FileSessionProject } from "./file-session-store-types.ts";

export const FILE_SESSION_STORE_VERSION = 1;
const FILE_SESSION_METADATA_DIR = ".runwield";
const FILE_SESSION_BUNDLES_DIR = "session-bundles";

export function isoNow(now?: () => string): string {
    return now ? now() : new Date().toISOString();
}

function deterministicProjectId(root: string): string {
    const digest = createHash("sha256").update(root).digest("hex");
    return `local-${digest.slice(0, 32)}`;
}

export function ensurePrivateDir(path: string): void {
    Deno.mkdirSync(path, { recursive: true, mode: 0o700 });
    try {
        Deno.chmodSync(path, 0o700);
    } catch {
        // Creation mode remains the best available protection on this filesystem.
    }
}

function syncParent(path: string): void {
    try {
        const directory = Deno.openSync(dirname(path), { read: true });
        try {
            directory.syncSync();
        } finally {
            directory.close();
        }
    } catch {
        // Some platforms do not permit directory fsync. The atomic rename still
        // prevents readers from observing a partially written JSON document.
    }
}

function writeTextAtomically(path: string, text: string): void {
    ensurePrivateDir(dirname(path));
    const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
    const file = Deno.openSync(temporaryPath, { createNew: true, write: true, mode: 0o600 });
    try {
        const bytes = new TextEncoder().encode(text);
        let written = 0;
        while (written < bytes.byteLength) written += file.writeSync(bytes.subarray(written));
        file.syncSync();
    } finally {
        file.close();
    }
    Deno.renameSync(temporaryPath, path);
    syncParent(path);
}

export function writeJsonAtomically<Value>(path: string, value: Value): void {
    writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<Value>(path: string): Value {
    return JSON.parse(Deno.readTextFileSync(path));
}

export function pathExists(path: string): boolean {
    try {
        Deno.lstatSync(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

function metadataDir(sessionDir: string): string {
    return join(sessionDir, FILE_SESSION_METADATA_DIR);
}

function projectPath(sessionDir: string): string {
    return join(metadataDir(sessionDir), "project.json");
}

function bundlesDir(sessionDir: string): string {
    return join(metadataDir(sessionDir), FILE_SESSION_BUNDLES_DIR);
}

export function bundleDir(sessionDir: string, runwieldSessionId: string): string {
    return join(bundlesDir(sessionDir), runwieldSessionId);
}

export function manifestPath(sessionDir: string, runwieldSessionId: string): string {
    return join(bundleDir(sessionDir, runwieldSessionId), "manifest.json");
}

export function lockPath(sessionDir: string, runwieldSessionId: string): string {
    return join(bundleDir(sessionDir, runwieldSessionId), "session.lock");
}

export function queuedMessagesPath(sessionDir: string, runwieldSessionId: string): string {
    return join(bundleDir(sessionDir, runwieldSessionId), "queued-messages.json");
}

export function queuedMessagesLockPath(sessionDir: string, runwieldSessionId: string): string {
    return join(bundleDir(sessionDir, runwieldSessionId), "queued-messages.lock");
}

export function catalogLockPath(sessionDir: string, transcriptPath: string): string {
    const directory = join(metadataDir(sessionDir), "catalog-locks");
    ensurePrivateDir(directory);
    const canonicalPath = Deno.realPathSync(transcriptPath);
    const key = createHash("sha256").update(canonicalPath).digest("hex");
    return join(directory, `${key}.lock`);
}

export function sessionDirForRoot(baseDir: string, root: string): string {
    return join(baseDir, encodeCwdForSessionDir(root));
}

export function sessionDirForManifestPath(path: string): string {
    return dirname(dirname(dirname(dirname(path))));
}

export function ensureProject(
    baseDir: string,
    root: string,
    now?: () => string,
    idFactory?: () => string,
): FileSessionProject {
    if (!root || !isAbsolute(root)) throw new Error("Project root must be absolute");
    const enteredRoot = resolve(root);
    const stat = Deno.statSync(enteredRoot);
    if (!stat.isDirectory) throw new Error("Project root must be a directory");
    const canonicalRoot = Deno.realPathSync(enteredRoot);
    const existing = listProjectsFromDisk(baseDir).find((project) =>
        resolve(project.currentRoot) === resolve(canonicalRoot) || resolve(project.registeredRoot) === enteredRoot
    );
    if (existing) return existing;
    const sessionDir = sessionDirForRoot(baseDir, canonicalRoot);
    ensurePrivateDir(sessionDir);
    const path = projectPath(sessionDir);
    if (pathExists(path)) {
        const project = readJson<FileSessionProject>(path);
        if (resolve(project.currentRoot) !== resolve(canonicalRoot)) {
            throw new Error("Session project identity does not match this directory");
        }
        return project;
    }
    const timestamp = isoNow(now);
    const project: FileSessionProject = {
        projectId: idFactory ? idFactory() : deterministicProjectId(canonicalRoot),
        displayName: basename(enteredRoot) || enteredRoot,
        registeredRoot: enteredRoot,
        currentRoot: canonicalRoot,
        lifecycle: "enabled",
        accessScope: "local_runtime",
        createdAt: timestamp,
        updatedAt: timestamp,
        disabledAt: null,
        removedAt: null,
        restoredAt: null,
        relinkedAt: null,
    };
    writeJsonAtomically(path, project);
    return project;
}

export function listProjectsFromDisk(baseDir: string): FileSessionProject[] {
    const projects: FileSessionProject[] = [];
    try {
        for (const entry of Deno.readDirSync(baseDir)) {
            if (!entry.isDirectory) continue;
            const path = projectPath(join(baseDir, entry.name));
            if (!pathExists(path)) continue;
            try {
                projects.push(readJson<FileSessionProject>(path));
            } catch {
                // A damaged Project record is not guessed at during a global scan.
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return projects.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function findProject(baseDir: string, projectId: string): FileSessionProject | null {
    return listProjectsFromDisk(baseDir).find((project) => project.projectId === projectId) || null;
}

export function rootEvidence(project: FileSessionProject) {
    return [{
        enteredRoot: project.registeredRoot,
        canonicalRoot: project.currentRoot,
        rootState: "current",
    }];
}

export function catalogedSession(manifest: FileSessionManifest) {
    const first = manifest.segments[0];
    const current = manifest.segments.find((segment) => segment.segmentId === manifest.currentSegmentId) ||
        manifest.segments.at(-1);
    if (!first || !current) throw new Error("Session manifest has no transcript segment");
    return {
        runwieldSessionId: manifest.runwieldSessionId,
        projectId: manifest.projectId,
        displayName: manifest.displayName,
        source: manifest.source,
        piSessionId: current.piSessionId,
        transcriptPath: current.transcriptPath,
        transcriptCwd: manifest.transcriptCwd,
        headerVersion: current.headerVersion,
        headerTimestamp: current.headerTimestamp,
        firstCatalogedAt: first.firstCatalogedAt,
        lastCatalogedAt: manifest.updatedAt,
    };
}

export function recoveryDescriptorPath(transcriptPath: string): string {
    return `${transcriptPath}.runwield.json`;
}

function writeRecoveryDescriptors(manifest: FileSessionManifest): void {
    for (const segment of manifest.segments) {
        try {
            writeJsonAtomically(recoveryDescriptorPath(segment.transcriptPath), manifest);
        } catch {
            // The primary manifest is already durable. A later successful
            // checkpoint will refresh all redundant recovery descriptors.
        }
    }
}

function restoreManifestsFromRecoveryDescriptors(sessionDir: string): void {
    const recoverable = new Map<string, FileSessionManifest>();
    try {
        for (const entry of Deno.readDirSync(sessionDir)) {
            if (!entry.isFile || !entry.name.endsWith(".jsonl.runwield.json")) continue;
            try {
                const candidate = readJson<FileSessionManifest>(join(sessionDir, entry.name));
                if (candidate.version !== FILE_SESSION_STORE_VERSION || !candidate.runwieldSessionId) continue;
                const previous = recoverable.get(candidate.runwieldSessionId);
                if (!previous || previous.updatedAt < candidate.updatedAt) {
                    recoverable.set(candidate.runwieldSessionId, candidate);
                }
            } catch {
                // Another descriptor for the same Session may still be valid.
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    for (const [runwieldSessionId, candidate] of recoverable) {
        const path = manifestPath(sessionDir, runwieldSessionId);
        if (pathExists(path)) {
            try {
                const existing = readJson<FileSessionManifest>(path);
                if (existing.version === FILE_SESSION_STORE_VERSION) continue;
            } catch {
                const damagedPath = `${path}.damaged-${Date.now()}`;
                try {
                    Deno.renameSync(path, damagedPath);
                } catch {
                    continue;
                }
            }
        }
        writeJsonAtomically(path, candidate);
    }
}

export function listManifests(sessionDir: string): Array<{ path: string; manifest: FileSessionManifest }> {
    restoreManifestsFromRecoveryDescriptors(sessionDir);
    const manifests: Array<{ path: string; manifest: FileSessionManifest }> = [];
    try {
        for (const entry of Deno.readDirSync(bundlesDir(sessionDir))) {
            if (!entry.isDirectory) continue;
            const path = manifestPath(sessionDir, entry.name);
            try {
                const manifest = readJson<FileSessionManifest>(path);
                if (manifest.version !== FILE_SESSION_STORE_VERSION || manifest.runwieldSessionId !== entry.name) {
                    continue;
                }
                manifests.push({ path, manifest });
            } catch {
                // Direct loads report damaged manifests. Global lists omit them
                // rather than inventing session identity from incomplete state.
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return manifests;
}

export function findManifestById(
    baseDir: string,
    runwieldSessionId: string,
): { path: string; manifest: FileSessionManifest } | null {
    for (const project of listProjectsFromDisk(baseDir)) {
        const sessionDir = sessionDirForRoot(baseDir, project.currentRoot);
        const found = listManifests(sessionDir).find((item) => item.manifest.runwieldSessionId === runwieldSessionId);
        if (found) return found;
    }
    return null;
}

export function writeManifest(manifest: FileSessionManifest, path: string): void {
    manifest.updatedAt = new Date().toISOString();
    writeJsonAtomically(path, manifest);
    writeRecoveryDescriptors(manifest);
}
