/**
 * @module cmd/plans/push
 * Push the current local shared Plan body as a new encrypted remote Revision.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import {
    hashPlanBody as hashPlanBodyFn,
    listPlanResources as listPlanResourcesFn,
    updatePlanCollaborationMetadata as updatePlanCollaborationMetadataFn,
} from "../../plan-store.js";
import { redactSecrets, REVIEWER_SCOPE } from "../../shared/collaboration/capabilities.js";
import { createCollaborationClient as createCollaborationClientFn } from "../../shared/collaboration/client.js";
import {
    encryptJsonPayload as encryptJsonPayloadFn,
    importContentKey as importContentKeyFn,
} from "../../shared/collaboration/crypto.js";
import { COLLABORATION_LOCK_BYPASS, COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";
import { normalizeRevisionMetadata, normalizeSharedSpaceMetadata } from "../../shared/collaboration/protocol.js";
import {
    getGlobalSecretStorePath as getGlobalSecretStorePathFn,
    getProjectSecretStorePath as getProjectSecretStorePathFn,
    resolvePullSecretRecord as resolvePullSecretRecordFn,
} from "../../shared/collaboration/secrets.js";
import { buildCollaborationUrl as buildCollaborationUrlFn } from "../../shared/collaboration/urls.js";
import { normalizePlanServerUrl as normalizePlanServerUrlFn } from "../../shared/settings.js";

/**
 * @typedef {Object} PlansPushArgs
 * @property {string} [target]
 * @property {string} [planServer]
 * @property {boolean} projectSecrets
 * @property {boolean} help
 */

/** @param {string[]} argv */
export function parsePlansPushArgs(argv) {
    const parsed = parseArgsFn(argv, {
        boolean: ["help", "project-secrets"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) return { help: true, projectSecrets: Boolean(parsed["project-secrets"]) };
    if (positionals.length === 0) throw new Error("Missing Plan name or id for push.");
    if (positionals.length > 1) throw new Error(`Unexpected push argument: ${positionals[1]}`);
    return {
        target: positionals[0],
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        help: false,
    };
}

function printPushHelp() {
    console.log(`Usage: ${CLI_BIN} plans push <plan-name-or-id> [--plan-server <url>] [--project-secrets]

Publishes the current local shared Plan body as a new encrypted remote Revision using maintainer secrets.`);
}

/** @param {unknown} value */
function normalizeSpaceResponse(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && "space" in value) {
        return normalizeSpaceResponse(/** @type {{ space: unknown }} */ (value).space);
    }
    return normalizeSharedSpaceMetadata(value);
}

/** @param {unknown} value */
function normalizeRevisionResponse(value) {
    if (
        value && typeof value === "object" && !Array.isArray(value) &&
        typeof /** @type {{ revision?: unknown }} */ (value).revision === "object"
    ) {
        return normalizeRevisionResponse(/** @type {{ revision: unknown }} */ (value).revision);
    }
    return normalizeRevisionMetadata(value);
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
        Number.isInteger(Number(attrs.collaborationRevision)) && Number(attrs.collaborationRevision) > 0 &&
        typeof attrs.collaborationBodyHash === "string" && attrs.collaborationBodyHash.length > 0;
}

/** @param {unknown} error @param {string[]} secrets */
function redactedError(error, secrets) {
    return redactSecrets(error, secrets);
}

/**
 * @param {{ target: string, cwd?: string, planServer?: string, projectSecrets?: boolean }} pushOptions
 * @param {Record<string, any>} [deps]
 */
export async function pushPlanRevision(pushOptions, deps = {}) {
    const cwd = pushOptions.cwd || deps.cwd || CWD;
    const now = deps.now || new Date().toISOString();
    const target = pushOptions.target;
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
    if (!planId) throw new Error("Shared Plan is missing planId; cannot push.");

    const normalizePlanServerUrl = deps.normalizePlanServerUrl || normalizePlanServerUrlFn;
    const serverUrl = pushOptions.planServer
        ? normalizePlanServerUrl(pushOptions.planServer)
        : String(attrs.collaborationServerUrl);
    if (serverUrl !== attrs.collaborationServerUrl) {
        throw new Error(
            "Plan Server override does not match the local Shared Plan collaborationServerUrl; refusing to push to a different server.",
        );
    }

    const paths = secretPaths(cwd, Boolean(pushOptions.projectSecrets), deps);
    const resolvePullSecretRecord = deps.resolvePullSecretRecord || resolvePullSecretRecordFn;
    const found = await resolvePullSecretRecord(paths, planId, spaceId);
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
    let space;
    try {
        const client = createCollaborationClient({
            serverUrl,
            bearerCapability: secretRecord.maintainerCapability,
            fetch: deps.fetch,
        });
        space = normalizeSpaceResponse(await client.getSharedSpace(spaceId));
    } catch (error) {
        throw new Error(`Unable to fetch remote Shared Space: ${redactedError(error, secrets)}`);
    }

    if (space.status === "closed") {
        throw new Error("Remote Shared Space is closed and cannot accept new revisions.");
    }
    if (space.planId !== planId) {
        throw new Error("Remote Shared Space planId does not match the local Plan; refusing to push.");
    }
    if (space.spaceId !== spaceId) {
        throw new Error("Remote Shared Space id does not match the local Plan; refusing to push.");
    }
    if (space.latestRevision > localRevision) {
        throw new Error("Remote Shared Space has a newer revision. Run `wld plans pull` before pushing.");
    }
    if (space.latestRevision < localRevision) {
        throw new Error("Local collaboration revision is newer than the remote Shared Space; refusing to push.");
    }

    const body = resource.body || "";
    const hashPlanBody = deps.hashPlanBody || hashPlanBodyFn;
    const currentBodyHash = await hashPlanBody(body);
    if (currentBodyHash === attrs.collaborationBodyHash) {
        throw new Error(
            "Local Plan body is unchanged from the last pulled/pushed revision; refusing to create a duplicate no-op revision.",
        );
    }

    const importContentKey = deps.importContentKey || importContentKeyFn;
    const encryptJsonPayload = deps.encryptJsonPayload || encryptJsonPayloadFn;
    const key = await importContentKey(secretRecord.contentKey);
    const payloadCiphertext = await encryptJsonPayload({
        planId,
        title: attrs.summary || planName,
        metadata: { ...attrs, planId },
        body,
    }, key);

    const expectedRevision = localRevision + 1;
    let appended;
    try {
        const client = createCollaborationClient({
            serverUrl,
            bearerCapability: secretRecord.maintainerCapability,
            fetch: deps.fetch,
        });
        appended = normalizeRevisionResponse(
            await client.appendRevision(spaceId, { payloadCiphertext, expectedRevision }),
        );
    } catch (error) {
        throw new Error(`Unable to append remote revision: ${redactedError(error, [...secrets, payloadCiphertext])}`);
    }
    if (appended.spaceId !== spaceId || appended.revision !== expectedRevision) {
        throw new Error(
            "Plan Server append response did not match the expected new revision; local metadata was not changed.",
        );
    }

    const updatePlanCollaborationMetadata = deps.updatePlanCollaborationMetadata || updatePlanCollaborationMetadataFn;
    try {
        await updatePlanCollaborationMetadata(
            cwd,
            planName,
            {
                ...attrs,
                planId,
                collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
                collaborationServerUrl: serverUrl,
                collaborationSpaceId: spaceId,
                collaborationRevision: appended.revision,
                collaborationBodyHash: currentBodyHash,
                collaborationSyncedAt: now,
                updatedAt: now,
            },
            COLLABORATION_LOCK_BYPASS.push,
            { body },
        );
    } catch (error) {
        throw new Error(
            `Remote revision ${appended.revision} was appended, but local collaboration metadata update failed. Run \`${CLI_BIN} plans pull ${planName}\` before retrying or editing further. ${
                redactedError(error, secrets)
            }`,
        );
    }

    const buildCollaborationUrl = deps.buildCollaborationUrl || buildCollaborationUrlFn;
    const reviewerUrl = secretRecord.reviewerCapability
        ? buildCollaborationUrl({
            serverUrl,
            spaceId,
            contentKey: secretRecord.contentKey,
            bearerCapability: secretRecord.reviewerCapability,
            role: REVIEWER_SCOPE,
        })
        : "";

    return {
        planName,
        planId,
        serverUrl,
        spaceId,
        previousRevision: localRevision,
        revision: appended.revision,
        reviewerUrl,
    };
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: Record<string, any> }} [options]
 */
export async function runPlansPushCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    const parseArgs = deps.parseArgs || parseArgsFn;
    const parsed = parsePlansPushArgsWith(parseArgs, argv);
    if (parsed.help) {
        printPushHelp();
        return;
    }
    const pushed = await pushPlanRevision({
        target: /** @type {string} */ (parsed.target),
        cwd: deps.cwd || CWD,
        planServer: parsed.planServer,
        projectSecrets: parsed.projectSecrets,
    }, deps);
    console.log(
        `[RunWield] Pushed Shared Space ${pushed.spaceId} revision ${pushed.revision} from local Plan: ${pushed.planName}.`,
    );
    if (pushed.reviewerUrl) {
        console.log(`[RunWield] Reviewer link remains valid: ${pushed.reviewerUrl}`);
    } else {
        console.log(
            "[RunWield] Existing reviewer links remain valid; this checkout does not have reviewer secrets to reconstruct the URL.",
        );
    }
    console.log(
        "[RunWield] Share the reviewer link with reviewers; do not share maintainer URLs unless handing off maintainer access.",
    );
}

/**
 * @param {typeof parseArgsFn} parseArgs
 * @param {string[]} argv
 * @returns {PlansPushArgs}
 */
function parsePlansPushArgsWith(parseArgs, argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help", "project-secrets"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) return { help: true, projectSecrets: Boolean(parsed["project-secrets"]) };
    if (positionals.length === 0) throw new Error("Missing Plan name or id for push.");
    if (positionals.length > 1) throw new Error(`Unexpected push argument: ${positionals[1]}`);
    return {
        target: positionals[0],
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        help: false,
    };
}
