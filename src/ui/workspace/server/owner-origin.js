/** @module ui/workspace/server/owner-origin */

/** @param {Headers} headers */
export function ownerSecurityHeaders(headers = new Headers()) {
    headers.set("cache-control", "no-store");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set(
        "content-security-policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    return headers;
}

/** @param {Response} response */
export function withOwnerSecurityHeaders(response) {
    const headers = new Headers(response.headers);
    ownerSecurityHeaders(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** @param {string} origin */
export function parseOwnerOrigin(origin) {
    const url = new URL(origin);
    return { origin: url.origin, host: url.host, protocol: url.protocol };
}

/** @param {Request} request @param {{ publicOrigin: string, host?: string }} policy */
export function assertOwnerHost(request, policy) {
    const expected = parseOwnerOrigin(policy.publicOrigin).host;
    const actual = request.headers.get("host") || new URL(request.url).host;
    if (actual !== expected) {
        throw new Error("Owner Workspace request Host is not allowed.");
    }
}

/** @param {Request} request @param {{ publicOrigin: string }} policy */
export function assertOwnerOrigin(request, policy) {
    const origin = request.headers.get("origin");
    if (!origin) throw new Error("Owner Workspace Origin header is required.");
    if (origin !== parseOwnerOrigin(policy.publicOrigin).origin) {
        throw new Error("Owner Workspace Origin is not allowed.");
    }
}

/** @param {Request} request */
export function isStateChangingRequest(request) {
    return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}
