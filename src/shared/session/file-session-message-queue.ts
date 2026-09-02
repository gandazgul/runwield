/**
 * @module shared/session/file-session-message-queue
 * Durable cross-surface input queued beside the Session manifest.
 */

import {
    ensurePrivateDir,
    findManifestById,
    isoNow,
    pathExists,
    queuedMessagesLockPath,
    queuedMessagesPath,
    readJson,
    sessionDirForManifestPath,
    writeJsonAtomically,
} from "./file-session-storage.ts";
import { dirname } from "@std/path";
import type {
    ClaimSessionMessageOptions,
    EnqueueSessionMessageOptions,
    FileSessionManifest,
    QueuedSessionMessage,
} from "./file-session-store-types.ts";

interface QueuedSessionMessageDocument {
    version: 1;
    messages: QueuedSessionMessage[];
}

interface FileSessionMessageQueueOptions {
    baseDir: string;
    now?: () => string;
}

const CLAIM_START_GRACE_MS = 2_000;

function publicMessage(message: QueuedSessionMessage): QueuedSessionMessage {
    const result = { ...message, images: message.images.map((image) => ({ ...image })) };
    delete result.claim;
    return result;
}

function readDocument(path: string): QueuedSessionMessageDocument {
    if (!pathExists(path)) return { version: 1, messages: [] };
    const value = readJson<QueuedSessionMessageDocument>(path);
    if (value.version !== 1 || !Array.isArray(value.messages)) {
        throw new Error("Queued Session messages are unavailable");
    }
    return value;
}

function claimStillOwnsActivation(message: QueuedSessionMessage, manifest: FileSessionManifest): boolean {
    return Boolean(
        message.claim && manifest.activation.state === "active" &&
            manifest.activation.ownerInstanceId === message.claim.ownerInstanceId,
    );
}

function reconcileDocument(
    document: QueuedSessionMessageDocument,
    manifest: FileSessionManifest,
    now: string,
): boolean {
    let changed = false;
    const generation = manifest.generation?.generation ?? null;
    document.messages = document.messages.filter((message) => {
        if (!message.claim) return true;
        if (generation !== null && generation >= message.claim.resultGeneration) {
            changed = true;
            return false;
        }
        if (claimStillOwnsActivation(message, manifest)) return true;
        const age = Date.parse(now) - Date.parse(message.claim.claimedAt);
        if (manifest.activation.state !== "active" && age < CLAIM_START_GRACE_MS) return true;
        delete message.claim;
        changed = true;
        return true;
    });
    return changed;
}

function withQueueLock<Result>(
    options: FileSessionMessageQueueOptions,
    runwieldSessionId: string,
    operation: (document: QueuedSessionMessageDocument, manifest: FileSessionManifest, path: string) => Result,
): Result {
    const found = findManifestById(options.baseDir, runwieldSessionId);
    if (!found) throw new Error("Session identity is unavailable");
    const sessionDir = sessionDirForManifestPath(found.path);
    ensurePrivateDir(dirname(queuedMessagesPath(sessionDir, runwieldSessionId)));
    const queueLockPath = queuedMessagesLockPath(sessionDir, runwieldSessionId);
    const file = Deno.openSync(queueLockPath, { create: true, read: true, write: true, mode: 0o600 });
    file.lockSync(true);
    try {
        const manifest = readJson<FileSessionManifest>(found.path);
        const path = queuedMessagesPath(sessionDir, runwieldSessionId);
        const document = readDocument(path);
        const now = isoNow(options.now);
        if (reconcileDocument(document, manifest, now)) writeJsonAtomically(path, document);
        return operation(document, manifest, path);
    } finally {
        file.unlockSync();
        file.close();
    }
}

export function createFileSessionMessageQueue(options: FileSessionMessageQueueOptions) {
    return {
        listQueuedSessionMessages(runwieldSessionId: string): QueuedSessionMessage[] {
            return withQueueLock(options, runwieldSessionId, (document) => document.messages.map(publicMessage));
        },

        enqueueSessionMessage(
            runwieldSessionId: string,
            messageOptions: EnqueueSessionMessageOptions,
        ): QueuedSessionMessage {
            return withQueueLock(options, runwieldSessionId, (document, _manifest, path) => {
                const message: QueuedSessionMessage = {
                    id: messageOptions.idFactory ? messageOptions.idFactory() : crypto.randomUUID(),
                    text: messageOptions.text,
                    images: (messageOptions.images || []).map((image) => ({ ...image })),
                    delivery: "lease",
                    queuedAt: isoNow(messageOptions.now || options.now),
                    queuedBy: messageOptions.queuedBy,
                };
                document.messages.push(message);
                writeJsonAtomically(path, document);
                return publicMessage(message);
            });
        },

        claimNextQueuedSessionMessage(
            runwieldSessionId: string,
            claimOptions: ClaimSessionMessageOptions,
        ): QueuedSessionMessage | null {
            return withQueueLock(options, runwieldSessionId, (document, manifest, path) => {
                if (manifest.activation.state !== "idle") return null;
                const message = document.messages.find((candidate) => !candidate.claim);
                if (!message) return null;
                const expectedGeneration = manifest.generation?.generation ?? null;
                message.claim = {
                    ownerInstanceId: claimOptions.ownerInstanceId,
                    ownerProcessKind: claimOptions.ownerProcessKind,
                    claimedAt: isoNow(claimOptions.now || options.now),
                    expectedGeneration,
                    resultGeneration: (expectedGeneration ?? -1) + 1,
                };
                writeJsonAtomically(path, document);
                return publicMessage(message);
            });
        },

        completeQueuedSessionMessage(
            runwieldSessionId: string,
            messageId: string,
            ownerInstanceId: string,
        ): boolean {
            return withQueueLock(options, runwieldSessionId, (document, manifest, path) => {
                const index = document.messages.findIndex((message) =>
                    message.id === messageId && message.claim?.ownerInstanceId === ownerInstanceId
                );
                if (index < 0) return false;
                const claim = document.messages[index].claim;
                const generation = manifest.generation?.generation ?? null;
                if (!claim || generation === null || generation < claim.resultGeneration) return false;
                document.messages.splice(index, 1);
                writeJsonAtomically(path, document);
                return true;
            });
        },

        releaseQueuedSessionMessage(
            runwieldSessionId: string,
            messageId: string,
            ownerInstanceId: string,
        ): boolean {
            return withQueueLock(options, runwieldSessionId, (document, _manifest, path) => {
                const message = document.messages.find((candidate) =>
                    candidate.id === messageId && candidate.claim?.ownerInstanceId === ownerInstanceId
                );
                if (!message) return false;
                delete message.claim;
                writeJsonAtomically(path, document);
                return true;
            });
        },

        dequeueLastQueuedSessionMessage(runwieldSessionId: string): QueuedSessionMessage | null {
            return withQueueLock(options, runwieldSessionId, (document, _manifest, path) => {
                let index = document.messages.length - 1;
                while (index >= 0 && document.messages[index].claim) index -= 1;
                if (index < 0) return null;
                const [message] = document.messages.splice(index, 1);
                writeJsonAtomically(path, document);
                return publicMessage(message);
            });
        },
    };
}
