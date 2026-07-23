/** @module ui/workspace/server/owner-auth */

import {
    OWNER_CSRF_COOKIE,
    OWNER_DEVICE_COOKIE,
    OWNER_DEVICE_MAX_AGE_SECONDS,
} from "../../../shared/owner-coordination/index.js";
import { assertOwnerOrigin, isStateChangingRequest, parseOwnerOrigin } from "./owner-origin.js";

/** @param {string} value */
function cookieValue(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** @param {string} cookieHeader */
export function parseCookies(cookieHeader) {
    const cookies = new Map();
    for (const part of String(cookieHeader || "").split(";")) {
        const index = part.indexOf("=");
        if (index < 0) continue;
        cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    }
    return cookies;
}

/** @param {Request} request @param {string} name */
export function getCookie(request, name) {
    return parseCookies(request.headers.get("cookie") || "").get(name) || "";
}

/**
 * @param {{ credential: string, csrf: string, publicOrigin: string }} options
 */
export function deviceCookieHeaders(options) {
    const secure = parseOwnerOrigin(options.publicOrigin).protocol === "https:";
    const suffix = `Max-Age=${OWNER_DEVICE_MAX_AGE_SECONDS}; Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
    return [
        `${OWNER_DEVICE_COOKIE}=${cookieValue(options.credential)}; ${suffix}; HttpOnly`,
        `${OWNER_CSRF_COOKIE}=${cookieValue(options.csrf)}; ${suffix}`,
    ];
}

/** @param {{ publicOrigin: string }} options */
export function clearDeviceCookieHeaders(options) {
    const secure = parseOwnerOrigin(options.publicOrigin).protocol === "https:";
    const suffix = `Max-Age=0; Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
    return [
        `${OWNER_DEVICE_COOKIE}=; ${suffix}; HttpOnly`,
        `${OWNER_CSRF_COOKIE}=; ${suffix}`,
    ];
}

/** @param {string} proof @param {{ publicOrigin: string }} options */
export function bootstrapProofCookieHeader(proof, options) {
    const secure = parseOwnerOrigin(options.publicOrigin).protocol === "https:";
    return `rw_pairing_proof=${cookieValue(proof)}; Max-Age=300; Path=/; SameSite=Strict${
        secure ? "; Secure" : ""
    }; HttpOnly`;
}

/** @param {{ publicOrigin: string }} options */
export function clearBootstrapProofCookieHeader(options) {
    const secure = parseOwnerOrigin(options.publicOrigin).protocol === "https:";
    return `rw_pairing_proof=; Max-Age=0; Path=/; SameSite=Strict${secure ? "; Secure" : ""}; HttpOnly`;
}

/**
 * @param {Request} request
 * @param {{ store: any, publicOrigin: string }} state
 */
export function authenticateOwnerRequest(request, state) {
    const credential = getCookie(request, OWNER_DEVICE_COOKIE);
    const device = credential ? state.store.verifyDeviceCredential(credential) : null;
    if (!device) return null;
    if (isStateChangingRequest(request)) {
        assertOwnerOrigin(request, { publicOrigin: state.publicOrigin });
        const csrfCookie = getCookie(request, OWNER_CSRF_COOKIE);
        const csrfHeader = request.headers.get("x-runwield-csrf") || "";
        if (!csrfCookie || csrfCookie !== csrfHeader || !state.store.verifyDeviceCsrf(device.deviceId, csrfCookie)) {
            throw new Error("Owner Workspace CSRF check failed.");
        }
    }
    return device;
}

/** @param {Request} request */
export function isOwnerUpgradeRequest(request) {
    return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * Authorize a future owner WebSocket upgrade using the same trusted device cookie
 * as HTTP APIs plus an exact Origin check. CSRF headers are unavailable on
 * browser WebSocket handshakes, so Origin is the CSRF-equivalent browser proof.
 *
 * @param {Request} request
 * @param {{ store: any, publicOrigin: string, ownerConnections?: { register?: (deviceId: string, connection: { close: () => void }) => () => void } }} state
 * @param {{ close: () => void }} [connection]
 */
export function authorizeOwnerUpgradeRequest(request, state, connection) {
    if (!isOwnerUpgradeRequest(request)) throw new Error("Owner Workspace upgrade request is required.");
    assertOwnerOrigin(request, { publicOrigin: state.publicOrigin });
    const credential = getCookie(request, OWNER_DEVICE_COOKIE);
    const device = credential ? state.store.verifyDeviceCredential(credential) : null;
    if (!device) throw new Error("Owner Workspace device pairing required.");
    const unregister = connection ? state.ownerConnections?.register?.(device.deviceId, connection) : undefined;
    return { ...device, unregister };
}
