/**
 * @module ui/tui/testing/subprocess-runner
 * Bounded subprocess runner used by Golden TUI scenarios.
 */

/**
 * @typedef {Object} GoldenChildResult
 * @property {boolean} success
 * @property {number | null} code
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 */

const SECRET_ENV_PATTERNS = [/API_KEY/i, /TOKEN/i, /AUTH/i, /SECRET/i, /PASSWORD/i];

/** @param {Record<string, string>} env */
export function sanitizeGoldenChildEnv(env = Deno.env.toObject()) {
    /** @type {Record<string, string>} */
    const sanitized = {};
    for (const [key, value] of Object.entries(env)) {
        if (SECRET_ENV_PATTERNS.some((pattern) => pattern.test(key))) continue;
        sanitized[key] = value;
    }
    return sanitized;
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, timeoutMs?: number }} [options]
 * @returns {Promise<GoldenChildResult>}
 */
export async function runGoldenChild(args, options = {}) {
    const command = new Deno.Command(Deno.execPath(), {
        args,
        cwd: options.cwd,
        env: { ...sanitizeGoldenChildEnv(), ...(options.env || {}) },
        stdout: "piped",
        stderr: "piped",
    });
    const child = command.spawn();
    const timeoutMs = options.timeoutMs || 5000;
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        try {
            child.kill("SIGKILL");
        } catch {
            // Process may have already exited.
        }
    }, timeoutMs);
    try {
        const output = await child.output();
        return {
            success: output.success,
            code: output.code,
            stdout: new TextDecoder().decode(output.stdout),
            stderr: new TextDecoder().decode(output.stderr),
            timedOut,
        };
    } finally {
        clearTimeout(timeout);
    }
}
