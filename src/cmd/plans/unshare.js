/**
 * @module cmd/plans/unshare
 * Destructively delete a remote Shared Space and intentionally clear local collaboration state.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import {
    clearPlanCollaborationMetadata as clearPlanCollaborationMetadataFn,
    listPlanResources as listPlanResourcesFn,
} from "../../plan-store.js";
import { redactSecrets } from "../../shared/collaboration/capabilities.js";
import { createCollaborationClient as createCollaborationClientFn } from "../../shared/collaboration/client.js";
import { COLLABORATION_LOCK_BYPASS, COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";
import { normalizeSharedSpaceMetadata } from "../../shared/collaboration/protocol.js";
import {
    deleteCompatibleSecretRecords as deleteCompatibleSecretRecordsFn,
    getGlobalSecretStorePath as getGlobalSecretStorePathFn,
    getProjectSecretStorePath as getProjectSecretStorePathFn,
    resolveCompatibleSecretRecord as resolveCompatibleSecretRecordFn,
} from "../../shared/collaboration/secrets.js";
import { normalizePlanServerUrl as normalizePlanServerUrlFn } from "../../shared/settings.js";

/**
 * @typedef {Object} PlansUnshareArgs
 * @property {string} [target]
 * @property {string} [planServer]
 * @property {boolean} projectSecrets
 * @property {boolean} force
 * @property {boolean} help
 */

/** @param {string[]} argv */
export function parsePlansUnshareArgs(argv) {
    const parsed = parseArgsFn(argv, {
        boolean: ["help", "project-secrets", "force"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) {
        return { help: true, projectSecrets: Boolean(parsed["project-secrets"]), force: Boolean(parsed.force) };
    }
    if (positionals.length === 0) throw new Error("Missing Plan name or id for unshare.");
    if (positionals.length > 1) throw new Error(`Unexpected unshare argument: ${positionals[1]}`);
    return {
        target: positionals[0],
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        force: Boolean(parsed.force),
        help: false,
    };
}

function printUnshareHelp() {
    console.log(`Usage: ${CLI_BIN} plans unshare <plan-name-or-id> [--plan-server <url>] [--project-secrets] [--force]

Deletes the remote Shared Space using maintainer secrets, then clears local collaboration secrets and lock metadata. This is destructive for all reviewer and maintainer links.`);
}

/** @param {unknown} value */
function normalizeSpaceResponse(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && "space" in value) {
        return normalizeSpaceResponse(/** @type {{ space: unknown }} */ (value).space);
    }
    return normalizeSharedSpaceMetadata(value);
}

/** @param {string} cwd @param {boolean} projectSecrets @param {any} deps */
function secretPaths(cwd, projectSecrets, deps) {
    const globalPath = (deps.getGlobalSecretStorePath || getGlobalSecretStorePathFn)();
    const projectPath = (deps.getProjectSecretStorePath || getProjectSecretStorePathFn)(cwd);
    return projectSecrets ? [projectPath, globalPath] : [globalPath, projectPath];
}

/** @param {any[]} resources @param {string} target */
function findResourceByNameOrId(resources, target) {
    const matches = resources.filter((resource) =>
        resource.planName === target || resource.name === target || resource.planId === target ||
        resource.attrs?.planId === target
    );
    if (matches.length > 1) throw new Error(`Multiple Plans matched ${target}; use a unique Plan name or planId.`);
    return matches[0] || null;
}

/** @param {Record<string, unknown>} attrs */
function hasCompleteRemoteCanonicalMetadata(attrs) {
    return attrs.collaborationState === COLLABORATION_STATE_REMOTE_CANONICAL &&
        typeof attrs.collaborationServerUrl === "string" && attrs.collaborationServerUrl.length > 0 &&
        typeof attrs.collaborationSpaceId === "string" && attrs.collaborationSpaceId.length > 0 &&
        Number.isInteger(Number(attrs.collaborationRevision)) && Number(attrs.collaborationRevision) > 0;
}

/** @param {unknown} error */
function errorStatus(error) {
    const status = /** @type {{ status?: unknown }} */ (error).status;
    return typeof status === "number" ? status : undefined;
}

/** @param {unknown} error */
function isNotFoundError(error) {
    return errorStatus(error) === 404;
}

/** @param {unknown} error */
function isAmbiguousRemoteError(error) {
    const status = errorStatus(error);
    if (status && status >= 500) return true;
    return /(?:Plan Server error 5\d\d|Network failure|ECONN|ETIMEDOUT|timeout|fetch failed)/i.test(
        String(/** @type {Error} */ (error)?.message || error),
    );
}

/** @param {unknown} error @param {string[]} secrets */
function redactedError(error, secrets) {
    return redactSecrets(error, secrets);
}

/** @param {string} message @param {Record<string, any>} deps */
async function confirm(message, deps) {
    if (deps.confirm) return Boolean(await deps.confirm(message));
    const answer = globalThis.prompt(`${message}\nType yes to continue: `) || "";
    return /^(?:y|yes)$/i.test(answer.trim());
}

/**
 * @param {{ planName: string, serverUrl: string, spaceId: string, revision: number, status?: string, alreadyDeleted?: boolean }} details
 */
function confirmationMessage(details) {
    const state = details.alreadyDeleted ? "clear local collaboration state for already-deleted" : "delete";
    return `Destructive unshare will ${state} Shared Space ${details.spaceId} for Plan ${details.planName} on ${details.serverUrl} (revision ${details.revision}, status ${
        details.status || "unknown"
    }). Reviewer and maintainer links will stop working, and other checkouts or browser sessions will need deleted-remote recovery.`;
}

/**
 * @param {{ target: string, cwd?: string, planServer?: string, projectSecrets?: boolean, force?: boolean }} unshareOptions
 * @param {Record<string, any>} [deps]
 */
export async function unsharePlan(unshareOptions, deps = {}) {
    const cwd = unshareOptions.cwd || deps.cwd || CWD;
    const now = deps.now || new Date().toISOString();
    const target = unshareOptions.target;
    const listPlanResources = deps.listPlanResources || listPlanResourcesFn;
    const resource = findResourceByNameOrId(await listPlanResources(cwd, { backfillMissing: false }), target);
    if (!resource) throw new Error(`Active Plan not found: ${target}`);
    const attrs = resource.attrs || {};
    if (!hasCompleteRemoteCanonicalMetadata(attrs)) {
        throw new Error(
            "Plan is not a complete shared remote-canonical Plan; run `wld plans share` or `wld plans pull` first.",
        );
    }

    const planId = resource.planId || attrs.planId;
    const planName = resource.planName || resource.name;
    const spaceId = String(attrs.collaborationSpaceId);
    const localRevision = Number(attrs.collaborationRevision);
    if (!planId) throw new Error("Shared Plan is missing planId; cannot unshare.");

    const normalizePlanServerUrl = deps.normalizePlanServerUrl || normalizePlanServerUrlFn;
    const serverUrl = unshareOptions.planServer
        ? normalizePlanServerUrl(unshareOptions.planServer)
        : String(attrs.collaborationServerUrl);
    if (serverUrl !== attrs.collaborationServerUrl) {
        throw new Error(
            "Plan Server override does not match the local Shared Plan collaborationServerUrl; refusing to unshare a different server.",
        );
    }

    const paths = secretPaths(cwd, Boolean(unshareOptions.projectSecrets), deps);
    const resolveCompatibleSecretRecord = deps.resolveCompatibleSecretRecord || resolveCompatibleSecretRecordFn;
    const found = await resolveCompatibleSecretRecord(paths, planId, spaceId);
    if (!found?.record?.contentKey) {
        throw new Error("Shared Plan local content key is missing; pull with the maintainer URL to import secrets.");
    }
    if (!found.record.maintainerCapability) {
        throw new Error(
            "Shared Plan local maintainer secrets are missing; pull with the maintainer URL to import them.",
        );
    }

    const secretRecord = found.record;
    const secrets = [secretRecord.contentKey, secretRecord.maintainerCapability, secretRecord.reviewerCapability || ""];
    const createCollaborationClient = deps.createCollaborationClient || createCollaborationClientFn;
    const client = createCollaborationClient({
        serverUrl,
        bearerCapability: secretRecord.maintainerCapability,
        fetch: deps.fetch,
    });

    let space = /** @type {ReturnType<typeof normalizeSharedSpaceMetadata> | null} */ (null);
    let alreadyDeleted = false;
    try {
        space = normalizeSpaceResponse(await client.getSharedSpace(spaceId));
    } catch (error) {
        if (isNotFoundError(error)) {
            alreadyDeleted = true;
        } else if (isAmbiguousRemoteError(error)) {
            throw new Error(
                `Unable to verify remote Shared Space; local collaboration metadata was not changed. Retry when the Plan Server is reachable. ${
                    redactedError(error, secrets)
                }`,
            );
        } else {
            throw new Error(
                `Unable to fetch remote Shared Space; local collaboration metadata was not changed. ${
                    redactedError(error, secrets)
                }`,
            );
        }
    }

    if (space) {
        if (space.planId !== planId) {
            throw new Error("Remote Shared Space planId does not match the local Plan; refusing to unshare.");
        }
        if (space.spaceId !== spaceId) {
            throw new Error("Remote Shared Space id does not match the local Plan; refusing to unshare.");
        }
    }

    const remoteDetails = {
        planName,
        serverUrl,
        spaceId,
        revision: space?.latestRevision || localRevision,
        status: space?.status || (alreadyDeleted ? "deleted" : "unknown"),
        alreadyDeleted,
    };
    if (!unshareOptions.force) {
        const accepted = await confirm(confirmationMessage(remoteDetails), deps);
        if (!accepted) {
            throw new Error(
                "Unshare cancelled; remote Shared Space and local collaboration metadata were not changed.",
            );
        }
    }

    let deletedDuringDelete = false;
    if (!alreadyDeleted) {
        try {
            await client.updateSharedSpaceLifecycle(spaceId, { action: "delete" });
        } catch (error) {
            if (isNotFoundError(error)) {
                alreadyDeleted = true;
                deletedDuringDelete = true;
            } else if (isAmbiguousRemoteError(error)) {
                throw new Error(
                    `Remote delete result is ambiguous; local collaboration metadata was not changed. Retry or verify before cleanup. ${
                        redactedError(error, secrets)
                    }`,
                );
            } else {
                throw new Error(
                    `Unable to delete remote Shared Space; local collaboration metadata was not changed. ${
                        redactedError(error, secrets)
                    }`,
                );
            }
        }
    }

    if (deletedDuringDelete && !unshareOptions.force) {
        const accepted = await confirm(confirmationMessage({ ...remoteDetails, alreadyDeleted: true }), deps);
        if (!accepted) {
            throw new Error(
                "Local cleanup cancelled for already-deleted Shared Space; local collaboration metadata was not changed.",
            );
        }
    }

    const deleteCompatibleSecretRecords = deps.deleteCompatibleSecretRecords || deleteCompatibleSecretRecordsFn;
    let deletedSecrets;
    try {
        deletedSecrets = await deleteCompatibleSecretRecords(paths, planId, spaceId);
    } catch (error) {
        throw new Error(
            `Remote Shared Space ${spaceId} is deleted, but local collaboration secret cleanup failed. Local Plan remains locked until cleanup is retried. ${
                redactedError(error, secrets)
            }`,
        );
    }

    const clearPlanCollaborationMetadata = deps.clearPlanCollaborationMetadata || clearPlanCollaborationMetadataFn;
    try {
        await clearPlanCollaborationMetadata(cwd, planName, COLLABORATION_LOCK_BYPASS.unshare, { updatedAt: now });
    } catch (error) {
        throw new Error(
            `Remote Shared Space ${spaceId} is deleted and ${deletedSecrets.length} local secret record(s) were removed, but local collaboration metadata cleanup failed. Remove the lock metadata or retry unshare before editing. ${
                redactedError(error, secrets)
            }`,
        );
    }

    return {
        planName,
        planId,
        serverUrl,
        spaceId,
        revision: remoteDetails.revision,
        alreadyDeleted,
        deletedSecretCount: deletedSecrets.length,
        localMetadataCleared: true,
    };
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: Record<string, any> }} [options]
 */
export async function runPlansUnshareCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    const parseArgs = deps.parseArgs || parseArgsFn;
    const parsed = parsePlansUnshareArgsWith(parseArgs, argv);
    if (parsed.help) {
        printUnshareHelp();
        return;
    }
    const result = await unsharePlan({
        target: /** @type {string} */ (parsed.target),
        cwd: deps.cwd || CWD,
        planServer: parsed.planServer,
        projectSecrets: parsed.projectSecrets,
        force: parsed.force,
    }, deps);
    const remoteState = result.alreadyDeleted ? "was already deleted" : "deleted";
    console.log(`[RunWield] Unshared ${result.planName}: remote Shared Space ${result.spaceId} ${remoteState}.`);
    console.log(`[RunWield] Removed ${result.deletedSecretCount} local collaboration secret record(s).`);
    console.log("[RunWield] Cleared local collaboration lock metadata; the Plan body was preserved.");
}

/** @param {typeof parseArgsFn} parseArgs @param {string[]} argv @returns {PlansUnshareArgs} */
function parsePlansUnshareArgsWith(parseArgs, argv) {
    if (parseArgs === parseArgsFn) return parsePlansUnshareArgs(argv);
    const parsed = parseArgs(argv, {
        boolean: ["help", "project-secrets", "force"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) {
        return { help: true, projectSecrets: Boolean(parsed["project-secrets"]), force: Boolean(parsed.force) };
    }
    if (positionals.length === 0) throw new Error("Missing Plan name or id for unshare.");
    if (positionals.length > 1) throw new Error(`Unexpected unshare argument: ${positionals[1]}`);
    return {
        target: positionals[0],
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        force: Boolean(parsed.force),
        help: false,
    };
}
