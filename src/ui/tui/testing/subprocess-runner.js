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

/**
 * Booting a child Deno process and loading the RunWield module graph costs
 * seconds, and that cost balloons on a loaded CI runner. Budget it separately
 * from the scenario itself so scenario timeouts stay meaningful: exceeding this
 * means the child never got off the ground, not that the scenario was slow.
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;

/**
 * Line the child prints once it is ready to execute scenario actions. Seeing it
 * hands the deadline over from the startup budget to the scenario budget.
 */
export const GOLDEN_CHILD_READY_MARKER = "__golden-tui-child-ready__";

/**
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(text: string) => void} [onText] receives the full text decoded so far
 */
async function readStream(stream, onText) {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream) {
        text += decoder.decode(chunk, { stream: true });
        onText?.(text);
    }
    return text + decoder.decode();
}

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
 * `timeoutMs` bounds the scenario. When `awaitReadyMarker` is set the clock does
 * not start until the child announces readiness, so a slow boot cannot consume
 * the scenario's budget; until then the looser `startupTimeoutMs` applies.
 *
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, timeoutMs?: number, startupTimeoutMs?: number, awaitReadyMarker?: boolean }} [options]
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
    const scenarioTimeoutMs = options.timeoutMs || 5000;
    let timedOut = false;
    const kill = () => {
        timedOut = true;
        try {
            child.kill("SIGKILL");
        } catch {
            // Process may have already exited.
        }
    };
    let ready = !options.awaitReadyMarker;
    let timeout = setTimeout(kill, ready ? scenarioTimeoutMs : options.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT_MS);
    const stdout = readStream(child.stdout, (text) => {
        if (ready || !text.includes(GOLDEN_CHILD_READY_MARKER)) return;
        ready = true;
        clearTimeout(timeout);
        timeout = setTimeout(kill, scenarioTimeoutMs);
    });
    const stderr = readStream(child.stderr);
    try {
        const status = await child.status;
        return {
            success: status.success,
            code: status.code,
            stdout: await stdout,
            stderr: await stderr,
            timedOut,
        };
    } finally {
        clearTimeout(timeout);
    }
}
