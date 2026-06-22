import { Buffer } from "node:buffer";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const READ_ONLY_SYSTEM_PATHS = [
    "/bin",
    "/usr",
    "/lib",
    "/lib64",
    "/sbin",
    "/etc",
];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
function buildSandboxEnv(env) {
    /** @type {Record<string, string>} */
    const sandboxEnv = {
        PATH: env.PATH || DEFAULT_PATH,
        LANG: env.LANG || "C.UTF-8",
    };
    if (env.TERM) sandboxEnv.TERM = env.TERM;
    return sandboxEnv;
}

/**
 * @param {string} path
 * @returns {string[]}
 */
function getParentDirs(path) {
    const parts = path.split("/").filter(Boolean);
    const dirs = [];
    for (let i = 1; i < parts.length; i++) {
        dirs.push(`/${parts.slice(0, i).join("/")}`);
    }
    return dirs;
}

/**
 * Build Bubblewrap args for a read-only project shell.
 *
 * @param {{ cwd: string, command: string, env?: Record<string, string | undefined> }} options
 * @returns {string[]}
 */
export function buildBubblewrapBashArgs({ cwd, command, env = {} }) {
    const sandboxEnv = buildSandboxEnv(env);
    const args = [
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
        "--clearenv",
    ];

    for (const [name, value] of Object.entries(sandboxEnv)) {
        args.push("--setenv", name, value);
    }

    args.push(
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
    );

    for (const path of READ_ONLY_SYSTEM_PATHS) {
        args.push("--ro-bind-try", path, path);
    }

    for (const path of getParentDirs(cwd)) {
        args.push("--dir", path);
    }

    args.push(
        "--ro-bind",
        cwd,
        cwd,
        "--chdir",
        cwd,
        "sh",
        "-c",
        command,
    );

    return args;
}

/**
 * @param {unknown} error
 * @param {string} bwrapPath
 * @returns {Error}
 */
function formatSpawnError(error, bwrapPath) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No such file") || message.includes("not found") || message.includes("os error 2")) {
        return new Error(
            `Read-only bash requires Bubblewrap (\`${bwrapPath}\`) on Linux, but it was not found in PATH. ` +
                'Install bubblewrap or set agents.<agent>.bashMode to "default".',
        );
    }
    return new Error(`Read-only bash failed to start Bubblewrap: ${message}`);
}

/**
 * @param {Deno.ChildProcess} proc
 */
function killProcess(proc) {
    try {
        proc.kill("SIGKILL");
    } catch (_error) {
        // Process may already have exited.
    }
}

/**
 * @param {{ platform?: string, bwrapPath?: string }} [options]
 * @returns {import('@earendil-works/pi-coding-agent').BashOperations}
 */
export function createReadOnlyBashOperations(options = {}) {
    const platform = options.platform || Deno.build.os;
    const bwrapPath = options.bwrapPath || "bwrap";

    return {
        async exec(command, cwd, { onData, signal, timeout, env }) {
            if (platform !== "linux") {
                throw new Error(
                    "Read-only bash mode requires Bubblewrap on Linux. " +
                        `Current platform is ${platform}; unrestricted bash was not executed.`,
                );
            }

            if (signal?.aborted) throw new Error("aborted");

            const args = buildBubblewrapBashArgs({ cwd, command, env: env || {} });
            /** @type {Deno.ChildProcess | null} */
            let proc = null;
            let timedOut = false;
            /** @type {ReturnType<typeof setTimeout> | undefined} */
            let timeoutId;

            const onAbort = () => {
                if (proc) killProcess(proc);
            };

            try {
                const denoCommand = new Deno.Command(bwrapPath, {
                    args,
                    cwd,
                    stdout: "piped",
                    stderr: "piped",
                    stdin: "null",
                });
                try {
                    proc = denoCommand.spawn();
                } catch (error) {
                    throw formatSpawnError(error, bwrapPath);
                }

                if (timeout !== undefined && timeout > 0) {
                    timeoutId = setTimeout(() => {
                        timedOut = true;
                        if (proc) killProcess(proc);
                    }, timeout * 1000);
                }

                if (signal) {
                    if (signal.aborted) onAbort();
                    else signal.addEventListener("abort", onAbort, { once: true });
                }

                /** @param {ReadableStream<Uint8Array>} stream */
                const readStream = async (stream) => {
                    const reader = stream.getReader();
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            if (value) onData(Buffer.from(value));
                        }
                    } finally {
                        reader.releaseLock();
                    }
                };

                const [status] = await Promise.all([
                    proc.status,
                    readStream(proc.stdout),
                    readStream(proc.stderr),
                ]);

                if (signal?.aborted) throw new Error("aborted");
                if (timedOut) throw new Error(`timeout:${timeout}`);

                return { exitCode: status.success ? 0 : status.code || 1 };
            } finally {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
                if (signal) signal.removeEventListener("abort", onAbort);
            }
        },
    };
}

/**
 * Create a bash-compatible tool definition that executes through Bubblewrap.
 *
 * @param {string} cwd
 * @param {{ platform?: string, bwrapPath?: string }} [options]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createReadOnlyBashToolDefinition(cwd, options = {}) {
    const tool = createBashToolDefinition(cwd, {
        operations: createReadOnlyBashOperations(options),
    });

    return /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition} */ ({
        ...tool,
        description: "Execute a bash command in a Bubblewrap read-only sandbox rooted at the current project. " +
            "The project is mounted read-only, host home is hidden, network is isolated, and unrestricted bash is never used as a fallback.",
        promptSnippet:
            "Execute discovery-only bash commands in a Bubblewrap read-only sandbox. The project is read-only and unrestricted bash is never used as a fallback.",
    });
}
