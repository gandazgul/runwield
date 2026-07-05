/**
 * @module cmd/plans/share
 * Publish an active saved Plan as a remote-canonical Shared Space.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import {
    ensurePlanIdentity as ensurePlanIdentityFn,
    hashPlanBody as hashPlanBodyFn,
    listPlanResources as listPlanResourcesFn,
    loadPlan as loadPlanFn,
    updatePlanCollaborationMetadata as updatePlanCollaborationMetadataFn,
} from "../../plan-store.js";
import {
    generateBearerCapability as generateBearerCapabilityFn,
    hashCapability as hashCapabilityFn,
    MAINTAINER_SCOPE,
    redactSecrets,
    REVIEWER_SCOPE,
} from "../../shared/collaboration/capabilities.js";
import { createCollaborationClient as createCollaborationClientFn } from "../../shared/collaboration/client.js";
import {
    encryptJsonPayload as encryptJsonPayloadFn,
    exportContentKey as exportContentKeyFn,
    generateContentKey as generateContentKeyFn,
} from "../../shared/collaboration/crypto.js";
import { COLLABORATION_LOCK_BYPASS, COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";
import { normalizeSharedSpaceMetadata } from "../../shared/collaboration/protocol.js";
import {
    deleteSecretRecord as deleteSecretRecordFn,
    ensureProjectSecretStoreIgnored as ensureProjectSecretStoreIgnoredFn,
    getGlobalSecretStorePath as getGlobalSecretStorePathFn,
    getProjectSecretStorePath as getProjectSecretStorePathFn,
    getSecretRecord as getSecretRecordFn,
    putSecretRecord as putSecretRecordFn,
} from "../../shared/collaboration/secrets.js";
import {
    buildCollaborationUrl as buildCollaborationUrlFn,
    redactCollaborationUrl,
} from "../../shared/collaboration/urls.js";
import {
    getDefaultPlanServerUrl as getDefaultPlanServerUrlFn,
    normalizePlanServerUrl as normalizePlanServerUrlFn,
} from "../../shared/settings.js";

/**
 * @typedef {Object} PlansShareArgs
 * @property {string} [planServer]
 * @property {boolean} projectSecrets
 * @property {boolean} help
 * @property {string} [target]
 */

/**
 * @typedef {Object} ShareCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof loadPlanFn} [loadPlan]
 * @property {typeof listPlanResourcesFn} [listPlanResources]
 * @property {typeof ensurePlanIdentityFn} [ensurePlanIdentity]
 * @property {typeof hashPlanBodyFn} [hashPlanBody]
 * @property {typeof updatePlanCollaborationMetadataFn} [updatePlanCollaborationMetadata]
 * @property {typeof getDefaultPlanServerUrlFn} [getDefaultPlanServerUrl]
 * @property {typeof normalizePlanServerUrlFn} [normalizePlanServerUrl]
 * @property {typeof generateContentKeyFn} [generateContentKey]
 * @property {typeof exportContentKeyFn} [exportContentKey]
 * @property {typeof encryptJsonPayloadFn} [encryptJsonPayload]
 * @property {typeof generateBearerCapabilityFn} [generateBearerCapability]
 * @property {typeof hashCapabilityFn} [hashCapability]
 * @property {typeof createCollaborationClientFn} [createCollaborationClient]
 * @property {typeof getGlobalSecretStorePathFn} [getGlobalSecretStorePath]
 * @property {typeof getProjectSecretStorePathFn} [getProjectSecretStorePath]
 * @property {typeof ensureProjectSecretStoreIgnoredFn} [ensureProjectSecretStoreIgnored]
 * @property {typeof getSecretRecordFn} [getSecretRecord]
 * @property {typeof putSecretRecordFn} [putSecretRecord]
 * @property {typeof deleteSecretRecordFn} [deleteSecretRecord]
 * @property {typeof buildCollaborationUrlFn} [buildCollaborationUrl]
 * @property {string} [cwd]
 * @property {string} [now]
 */

/** @param {string[]} argv */
export function parsePlansShareArgs(argv) {
    const parsed = parseArgsFn(argv, {
        boolean: ["help", "project-secrets"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) return { help: true, projectSecrets: Boolean(parsed["project-secrets"]) };
    if (positionals.length === 0) throw new Error("Missing Plan name or id for share.");
    if (positionals.length > 1) throw new Error(`Unexpected share argument: ${positionals[1]}`);
    return {
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        help: false,
        target: positionals[0],
    };
}

function printShareHelp() {
    console.log(`Usage: ${CLI_BIN} plans share <plan-name-or-id> [--plan-server <url>] [--project-secrets]

Publishes an active saved Plan to a remote Plan Server and prints secret reviewer/maintainer URLs once.`);
}

/**
 * @param {unknown} value
 * @returns {{ spaceId: string, latestRevision: number }}
 */
function normalizeCreateResponse(value) {
    if (value && typeof value === "object" && !Array.isArray(value) && "space" in value) {
        return normalizeCreateResponse(/** @type {{ space: unknown }} */ (value).space);
    }
    const metadata = normalizeSharedSpaceMetadata(value);
    if (metadata.latestRevision !== 1) throw new Error("Plan Server create response must report latestRevision 1.");
    return { spaceId: metadata.spaceId, latestRevision: metadata.latestRevision };
}

/**
 * @param {string} cwd
 * @param {string} target
 * @param {ShareCommandDependencies} deps
 */
async function resolveActivePlan(cwd, target, deps) {
    const loadPlan = deps.loadPlan || loadPlanFn;
    const ensurePlanIdentity = deps.ensurePlanIdentity || ensurePlanIdentityFn;
    const listPlanResources = deps.listPlanResources || listPlanResourcesFn;

    if (target.replaceAll("\\", "/").startsWith("archived/")) {
        throw new Error("Cannot share archived Plans. Restore the Plan first, then run `wld plans share <plan>`.");
    }

    try {
        const named = await loadPlan(cwd, target);
        if (named) return await ensurePlanIdentity(cwd, target);
    } catch (error) {
        if (error instanceof Error && /must be relative|cannot escape/.test(error.message)) {
            throw new Error(
                "Can only share active saved Plans under plans/. External markdown files are not supported.",
            );
        }
    }

    const resources = await listPlanResources(cwd, { backfillMissing: false });
    const matches = resources.filter((resource) => resource.planId === target);
    if (matches.length > 1) {
        throw new Error(`Duplicate planId values found for ${target}; repair plan front matter before continuing.`);
    }
    if (matches.length === 1) return matches[0];

    throw new Error(
        `Active saved Plan not found by name or planId: ${target}. Use \`${CLI_BIN} plans\` to list active Plans.`,
    );
}

/**
 * @param {PlansShareArgs} args
 * @param {ShareCommandDependencies} deps
 */
function resolvePlanServerUrl(args, deps) {
    const normalizePlanServerUrl = deps.normalizePlanServerUrl || normalizePlanServerUrlFn;
    if (args.planServer) return normalizePlanServerUrl(args.planServer);
    const getDefaultPlanServerUrl = deps.getDefaultPlanServerUrl || getDefaultPlanServerUrlFn;
    const configured = getDefaultPlanServerUrl();
    if (!configured) {
        throw new Error(
            "Missing Plan Server URL. Pass --plan-server <url> or configure planServerUrl in RunWield settings.",
        );
    }
    return normalizePlanServerUrl(configured);
}

/**
 * @param {string} planId
 * @param {string} spaceId
 */
function secretRecordKey(planId, spaceId) {
    return `${planId}:${spaceId}`;
}

/**
 * @param {ShareCommandDependencies} deps
 * @param {string} secretStorePath
 * @param {string} planId
 * @param {string} spaceId
 */
async function assertNoConflictingSecretRecord(deps, secretStorePath, planId, spaceId) {
    const getSecretRecord = deps.getSecretRecord || getSecretRecordFn;
    const existingByPlan = await getSecretRecord(secretStorePath, planId);
    if (existingByPlan && existingByPlan.spaceId && existingByPlan.spaceId !== spaceId) {
        throw new Error(`Local collaboration secrets already exist for planId ${planId} and a different remote space.`);
    }
    const existingByPair = await getSecretRecord(secretStorePath, secretRecordKey(planId, spaceId));
    if (existingByPair && existingByPair.spaceId && existingByPair.spaceId !== spaceId) {
        throw new Error(`Local collaboration secrets already exist for planId ${planId} and a different remote space.`);
    }
}

/**
 * @param {ShareCommandDependencies} deps
 * @param {string} serverUrl
 * @param {string} spaceId
 * @param {string} maintainerCapability
 */
async function cleanupRemoteSpace(deps, serverUrl, spaceId, maintainerCapability) {
    const createCollaborationClient = deps.createCollaborationClient || createCollaborationClientFn;
    const client = createCollaborationClient({ serverUrl, bearerCapability: maintainerCapability });
    await client.updateSharedSpaceLifecycle(spaceId, { action: "delete" });
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: ShareCommandDependencies }} [options]
 */
export async function runPlansShareCommand(argv, options = {}) {
    const deps = /** @type {ShareCommandDependencies} */ (options.__testDeps || {});
    const parseArgs = deps.parseArgs || parseArgsFn;
    const args = parsePlansShareArgsWith(parseArgs, argv);
    if (args.help) {
        printShareHelp();
        return;
    }

    const cwd = deps.cwd || CWD;
    const target = /** @type {string} */ (args.target);
    const resource = await resolveActivePlan(cwd, target, deps);
    if (resource.attrs.collaborationState === COLLABORATION_STATE_REMOTE_CANONICAL) {
        throw new Error(
            "This Plan is already shared and remote-canonical. Use future `wld plans pull`, `wld plans push`, or `wld plans unshare` flows.",
        );
    }

    const serverUrl = resolvePlanServerUrl(args, deps);
    const now = deps.now || new Date().toISOString();
    const generateContentKey = deps.generateContentKey || generateContentKeyFn;
    const exportContentKey = deps.exportContentKey || exportContentKeyFn;
    const encryptJsonPayload = deps.encryptJsonPayload || encryptJsonPayloadFn;
    const generateBearerCapability = deps.generateBearerCapability || generateBearerCapabilityFn;
    const hashCapability = deps.hashCapability || hashCapabilityFn;
    const createCollaborationClient = deps.createCollaborationClient || createCollaborationClientFn;
    const buildCollaborationUrl = deps.buildCollaborationUrl || buildCollaborationUrlFn;

    const contentKey = await generateContentKey();
    const exportedContentKey = await exportContentKey(contentKey);
    const reviewerCapability = generateBearerCapability();
    const maintainerCapability = generateBearerCapability();
    const payloadCiphertext = await encryptJsonPayload({
        planId: resource.planId,
        title: resource.attrs.summary || resource.name,
        metadata: { ...resource.attrs },
        body: resource.body,
    }, contentKey);
    const reviewerHash = await hashCapability(reviewerCapability);
    const maintainerHash = await hashCapability(maintainerCapability);
    /** @type {import("../../shared/collaboration/protocol.js").CreateSharedSpacePayload} */
    const createPayload = {
        planId: resource.planId,
        initialRevision: { payloadCiphertext },
        capabilities: [
            { scope: REVIEWER_SCOPE, capabilityHash: reviewerHash },
            { scope: MAINTAINER_SCOPE, capabilityHash: maintainerHash },
        ],
    };

    const unauthenticatedClient = createCollaborationClient({ serverUrl, bearerCapability: "" });
    let created;
    let reviewerUrl = "";
    let maintainerUrl = "";
    let secretStorePath = "";
    let localSecretKey = "";
    try {
        created = normalizeCreateResponse(await unauthenticatedClient.createSharedSpace(createPayload));
        reviewerUrl = buildCollaborationUrl({
            serverUrl,
            spaceId: created.spaceId,
            contentKey: exportedContentKey,
            bearerCapability: reviewerCapability,
            role: REVIEWER_SCOPE,
        });
        maintainerUrl = buildCollaborationUrl({
            serverUrl,
            spaceId: created.spaceId,
            contentKey: exportedContentKey,
            bearerCapability: maintainerCapability,
            role: MAINTAINER_SCOPE,
        });

        const getGlobalSecretStorePath = deps.getGlobalSecretStorePath || getGlobalSecretStorePathFn;
        const getProjectSecretStorePath = deps.getProjectSecretStorePath || getProjectSecretStorePathFn;
        secretStorePath = args.projectSecrets ? getProjectSecretStorePath(cwd) : getGlobalSecretStorePath();
        if (args.projectSecrets) {
            const ensureProjectSecretStoreIgnored = deps.ensureProjectSecretStoreIgnored ||
                ensureProjectSecretStoreIgnoredFn;
            await ensureProjectSecretStoreIgnored(cwd);
        }
        await assertNoConflictingSecretRecord(deps, secretStorePath, resource.planId, created.spaceId);
        const putSecretRecord = deps.putSecretRecord || putSecretRecordFn;
        localSecretKey = secretRecordKey(resource.planId, created.spaceId);
        const secretRecord = {
            planId: resource.planId,
            spaceId: created.spaceId,
            contentKey: exportedContentKey,
            reviewerCapability,
            maintainerCapability,
            updatedAt: now,
        };
        await putSecretRecord(secretStorePath, localSecretKey, secretRecord);

        const hashPlanBody = deps.hashPlanBody || hashPlanBodyFn;
        const updatePlanCollaborationMetadata = deps.updatePlanCollaborationMetadata ||
            updatePlanCollaborationMetadataFn;
        await updatePlanCollaborationMetadata(
            cwd,
            resource.name,
            {
                collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
                collaborationServerUrl: serverUrl,
                collaborationSpaceId: created.spaceId,
                collaborationRevision: 1,
                collaborationBodyHash: await hashPlanBody(resource.body),
                collaborationSyncedAt: now,
            },
            COLLABORATION_LOCK_BYPASS.share,
            { body: resource.body },
        );
    } catch (error) {
        if (!created) throw error;
        try {
            await cleanupRemoteSpace(deps, serverUrl, created.spaceId, maintainerCapability);
        } catch (cleanupError) {
            console.error(
                `[RunWield] Failed to clean up remote Shared Space ${created.spaceId}: ${
                    redactSecrets(cleanupError, [reviewerCapability, maintainerCapability, exportedContentKey])
                }`,
            );
            console.error("[RunWield] Remote space may still exist. Save this recovery maintainer URL securely:");
            console.error(maintainerUrl);
            throw new Error(
                `Share failed after remote creation and cleanup also failed. Recovery URL was printed once. Original error: ${
                    redactSecrets(error, [reviewerCapability, maintainerCapability, exportedContentKey])
                }`,
            );
        }
        if (secretStorePath && localSecretKey) {
            const deleteSecretRecord = deps.deleteSecretRecord || deleteSecretRecordFn;
            try {
                await deleteSecretRecord(secretStorePath, localSecretKey);
            } catch (secretCleanupError) {
                throw new Error(
                    `Share failed after remote creation; remote Shared Space ${created.spaceId} was deleted, but local secret cleanup failed for ${localSecretKey} in ${secretStorePath}. Remove that stale record before retrying. Original error: ${
                        redactSecrets(error, [reviewerCapability, maintainerCapability, exportedContentKey])
                    } Secret cleanup error: ${
                        redactSecrets(secretCleanupError, [
                            reviewerCapability,
                            maintainerCapability,
                            exportedContentKey,
                        ])
                    }`,
                );
            }
        }
        throw new Error(
            `Share failed after remote creation; remote Shared Space ${created.spaceId} was deleted and local secret state was cleaned up. ${
                redactSecrets(error, [reviewerCapability, maintainerCapability, exportedContentKey])
            }`,
        );
    }

    console.log(`[RunWield] Shared Plan ${resource.name} as remote Shared Space ${created.spaceId} (revision 1).`);
    console.log("\nReviewer URL (secret; share only with reviewers):");
    console.log(reviewerUrl);
    console.log("\nMaintainer URL (powerful secret):");
    console.log(maintainerUrl);
    console.log(
        "\nWarning: anyone with the maintainer URL can pull, push, close, or unshare this Shared Space. Store these URLs securely; RunWield will not print them again.",
    );
    console.log(
        `[RunWield] Stored local secret material outside Plan front matter/settings. API/server URL: ${
            redactCollaborationUrl(serverUrl)
        }`,
    );
}

/**
 * @param {typeof parseArgsFn} parseArgs
 * @param {string[]} argv
 * @returns {PlansShareArgs}
 */
function parsePlansShareArgsWith(parseArgs, argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help", "project-secrets"],
        string: ["plan-server"],
        alias: { h: "help" },
    });
    const positionals = parsed._.map(String);
    if (parsed.help) return { help: true, projectSecrets: Boolean(parsed["project-secrets"]) };
    if (positionals.length === 0) throw new Error("Missing Plan name or id for share.");
    if (positionals.length > 1) throw new Error(`Unexpected share argument: ${positionals[1]}`);
    return {
        planServer: typeof parsed["plan-server"] === "string" ? parsed["plan-server"] : undefined,
        projectSecrets: Boolean(parsed["project-secrets"]),
        help: false,
        target: positionals[0],
    };
}
