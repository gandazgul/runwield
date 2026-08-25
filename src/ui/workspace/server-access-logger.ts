/**
 * Small dependency-free access logger for Workspace HTTP requests.
 * It logs metadata only. Request bodies, headers, and query values are not logged.
 */

type AccessLogMode = "dev" | "prod";

type AccessLogRecord = {
    event: "access" | "error";
    method: string;
    path: string;
    status: number;
    durationMs: number;
    error?: string;
};

function writeRecord(record: AccessLogRecord, mode: AccessLogMode): void {
    if (mode === "prod") {
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...record }));
        return;
    }
    const suffix = record.error ? ` error=${JSON.stringify(record.error)}` : "";
    console.log(
        `[Workspace] ${record.method} ${record.path} ${record.status} ${record.durationMs}ms${suffix}`,
    );
}

/**
 * Wrap a server handler with request access and error logging.
 * @param {(request: Request) => Promise<Response>} handler
 * @param {{ mode?: AccessLogMode }} [options]
 */
export function withAccessLogger(
    handler: (request: Request) => Promise<Response>,
    options: { mode?: AccessLogMode } = {},
): (request: Request) => Promise<Response> {
    const mode = options.mode || "dev";
    return async (request: Request): Promise<Response> => {
        const startedAt = performance.now();
        const url = new URL(request.url);
        try {
            const response = await handler(request);
            writeRecord({
                event: response.status >= 400 ? "error" : "access",
                method: request.method,
                path: url.pathname,
                status: response.status,
                durationMs: Math.round(performance.now() - startedAt),
                ...(response.status >= 400 ? { error: `HTTP ${response.status}` } : {}),
            }, mode);
            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            writeRecord({
                event: "error",
                method: request.method,
                path: url.pathname,
                status: 500,
                durationMs: Math.round(performance.now() - startedAt),
                error: message,
            }, mode);
            throw error;
        }
    };
}
