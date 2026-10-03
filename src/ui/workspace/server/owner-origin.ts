/** @module ui/workspace/server/owner-origin */

export interface OwnerOriginPolicy {
    publicOrigin: string;
    host?: string;
}

export function ownerSecurityHeaders(headers: Headers = new Headers()): Headers {
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

export function withOwnerSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    ownerSecurityHeaders(headers);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function parseOwnerOrigin(origin: string) {
    const url = new URL(origin);
    return { origin: url.origin, host: url.host, protocol: url.protocol };
}

export function assertOwnerHost(request: Request, policy: OwnerOriginPolicy): void {
    const expected = parseOwnerOrigin(policy.publicOrigin).host;
    const actual = request.headers.get("host") || new URL(request.url).host;
    if (actual !== expected) {
        throw new Error("Owner Workspace request Host is not allowed.");
    }
}

export function assertOwnerOrigin(request: Request, policy: OwnerOriginPolicy): void {
    const origin = request.headers.get("origin");
    if (!origin) throw new Error("Owner Workspace Origin header is required.");
    if (origin !== parseOwnerOrigin(policy.publicOrigin).origin) {
        throw new Error("Owner Workspace Origin is not allowed.");
    }
}

export function isStateChangingRequest(request: Request): boolean {
    return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}
