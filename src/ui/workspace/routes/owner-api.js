/** @module ui/workspace/routes/owner-api */

import {
    clearBootstrapProofCookieHeader,
    clearDeviceCookieHeaders,
    deviceCookieHeaders,
    getCookie,
} from "../server/owner-auth.js";
import { loadBoard, loadWorkspaceDetail } from "../server/plan-adapter.js";
import { listOwnerProjects, requireOwnerProjectRoot, serializeOwnerProject } from "../server/owner-projects.js";
import { ownerSecurityHeaders } from "../server/owner-origin.js";

const MAX_JSON_BYTES = 64 * 1024;

/** @param {unknown} body @param {number} [status] */
export function ownerJson(body, status = 200, headers = new Headers()) {
    ownerSecurityHeaders(headers);
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(body), { status, headers });
}

/** @param {Request} request */
async function readJson(request) {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("Request body is too large.");
    return text ? JSON.parse(text) : {};
}

/** @param {unknown} error */
export function sanitizeOwnerError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/[/\\]|[A-Za-z]:/.test(message)) return "Owner Workspace operation failed.";
    return message;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeOwnerPlanValue(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sanitizeOwnerPlanValue);
    /** @type {Record<string, unknown>} */
    const safe = {};
    for (const [key, child] of Object.entries(value)) {
        if (/(path|root|cwd|file)$/i.test(key)) continue;
        safe[key] = sanitizeOwnerPlanValue(child);
    }
    return safe;
}

/** @param {string} value */
function scrubLocalPaths(value) {
    return value
        .replace(/\b[A-Za-z]:[\\/][^\s"'`<>),;]*/g, "[local path]")
        .replace(/(^|[\s("'`=:])\/[A-Za-z0-9._~+\-/]+/g, "$1[local path]");
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeOwnerDiagnosticValue(value) {
    if (typeof value === "string") return scrubLocalPaths(value);
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sanitizeOwnerDiagnosticValue);
    /** @type {Record<string, unknown>} */
    const safe = {};
    for (const [key, child] of Object.entries(value)) {
        if (/(path|root|cwd|file)$/i.test(key)) continue;
        safe[key] = sanitizeOwnerDiagnosticValue(child);
    }
    return safe;
}

/** @param {unknown} error */
export function ownerErrorJson(error, status = 400) {
    return ownerJson({ error: sanitizeOwnerError(error) }, status);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function ownerReadOnlyPlanValue(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(ownerReadOnlyPlanValue);
    /** @type {Record<string, unknown>} */
    const readOnly = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === "actions") readOnly[key] = {};
        else if (key === "capabilities" && child && typeof child === "object" && !Array.isArray(child)) {
            readOnly[key] = { ...child, bodyEditing: false };
        } else readOnly[key] = ownerReadOnlyPlanValue(child);
    }
    return readOnly;
}

/** @param {any} ctx */
export async function pairingRequestApi(ctx) {
    try {
        ctx.state.pairingRateLimit?.check(ctx.req);
        const body = await readJson(ctx.req);
        const request = ctx.state.store.createPairingRequest({ deviceLabel: body.deviceLabel || "Browser device" });
        const headers = new Headers();
        headers.append("set-cookie", ctx.state.bootstrapProofCookieHeader(request.proof));
        return ownerJson({ code: request.code, expiresAt: request.expiresAt, state: request.state }, 201, headers);
    } catch (error) {
        return ownerErrorJson(
            error,
            String(error instanceof Error ? error.message : error).startsWith("Too many pairing") ? 429 : 400,
        );
    }
}

/** @param {any} ctx */
export function pairingStatusApi(ctx) {
    const proof = getCookie(ctx.req, "rw_pairing_proof");
    if (!proof) return ownerJson({ state: "missing" }, 404);
    const request = ctx.state.store.getPairingRequestByProof(proof);
    if (!request) return ownerJson({ state: "expired" }, 404);
    return ownerJson({ state: request.state, expiresAt: request.expiresAt, deviceLabel: request.deviceLabel });
}

/** @param {any} ctx */
export function pairingClaimApi(ctx) {
    try {
        const proof = getCookie(ctx.req, "rw_pairing_proof");
        if (!proof) throw new Error("Pairing browser proof is missing.");
        const claimed = ctx.state.store.claimPairingRequest(proof);
        const headers = new Headers();
        for (
            const header of deviceCookieHeaders({
                credential: claimed.credential,
                csrf: claimed.csrf,
                publicOrigin: ctx.state.publicOrigin,
            })
        ) headers.append("set-cookie", header);
        headers.append("set-cookie", clearBootstrapProofCookieHeader({ publicOrigin: ctx.state.publicOrigin }));
        return ownerJson({ paired: true, device: claimed.device }, 201, headers);
    } catch (error) {
        return ownerErrorJson(error);
    }
}

/** @param {any} ctx */
export function projectsApi(ctx) {
    return ownerJson({ projects: listOwnerProjects(ctx.state.store) });
}

/** @param {any} ctx */
export async function registerProjectApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        if (!body.root) throw new Error("Project root is required.");
        const project = ctx.state.store.registerProject({ root: String(body.root), displayName: body.displayName });
        return ownerJson({
            project: serializeOwnerProject(project, ctx.state.store.getProjectHealth(project.projectId)),
        }, 201);
    } catch (error) {
        return ownerErrorJson(error);
    }
}

/** @param {any} ctx */
export async function projectActionApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        const { projectId } = ctx.params;
        if (body.action === "disable") ctx.state.store.setProjectEnabled(projectId, false);
        else if (body.action === "enable") ctx.state.store.setProjectEnabled(projectId, true);
        else if (body.action === "remove") ctx.state.store.removeProject(projectId);
        else if (body.action === "restore") ctx.state.store.restoreProject(projectId);
        else if (body.action === "relink") {
            ctx.state.store.relinkProject({ projectId, newRoot: String(body.newRoot || "") });
        } else if (body.action === "rescan") {
            const result = await ctx.state.store.catalogProjectSessions(projectId, { fullRescan: true });
            return ownerJson({
                projects: listOwnerProjects(ctx.state.store),
                diagnostics: sanitizeOwnerDiagnosticValue(result.diagnostics || []),
            });
        } else throw new Error("Unknown Project action.");
        return ownerJson({ projects: listOwnerProjects(ctx.state.store) });
    } catch (error) {
        return ownerErrorJson(error);
    }
}

/** @param {any} ctx */
/** @param {any} ctx */
export async function ownerProjectBoardApi(ctx) {
    try {
        const root = requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const board = await loadBoard(root);
        const requestedView = ctx.params.view || "active";
        const view = requestedView === "closed"
            ? "closed"
            : requestedView === "onHold" || requestedView === "on-hold"
            ? "onHold"
            : "active";
        const screen = board.screens?.[view] || { columns: [] };
        return ownerJson({
            projectId: ctx.params.projectId,
            view,
            board: sanitizeOwnerPlanValue(ownerReadOnlyPlanValue(screen)),
            readOnly: true,
        });
    } catch (error) {
        return ownerErrorJson(error, 404);
    }
}

/** @param {any} ctx */
export async function ownerProjectPlanDetailApi(ctx) {
    try {
        const root = requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const plan = ownerReadOnlyPlanValue(await loadWorkspaceDetail(root, ctx.params.planId));
        return ownerJson({ projectId: ctx.params.projectId, plan: sanitizeOwnerPlanValue(plan), readOnly: true });
    } catch (error) {
        return ownerErrorJson(error, 404);
    }
}

/** @param {any} ctx */
export function devicesApi(ctx) {
    return ownerJson({
        devices: ctx.state.store.listDevices(),
        currentDeviceId: ctx.state.ownerDevice?.deviceId || null,
    });
}

/** @param {any} ctx */
export async function revokeDeviceApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        const device = ctx.state.store.revokeDevice(ctx.params.deviceId, { reason: body.reason || "revoked" });
        ctx.state.ownerConnections?.closeDevice?.(ctx.params.deviceId);
        const headers = new Headers();
        if (ctx.state.ownerDevice?.deviceId === ctx.params.deviceId) {
            for (const header of clearDeviceCookieHeaders({ publicOrigin: ctx.state.publicOrigin })) {
                headers.append("set-cookie", header);
            }
        }
        return ownerJson({ device }, 200, headers);
    } catch (error) {
        return ownerErrorJson(error);
    }
}
