/**
 * Build the standalone RunWield binary.
 */

import { dirname } from "@std/path";

export const DENO_COMPILE_VERSION = "2.9.2";

const STATIC_INCLUDE_PATHS = [
    "src/ui/workspace/static/",
    "src/ui/design-system/tokens.css",
    "src/ui/design-system/components.css",
    "logo.svg",
    "dist/workspace-runtime/server.mjs",
    "dist/workspace-runtime/client/",
    "src/ui/workspace/server/plan-adapter.js",
    "src/agent-definitions",
    "src/prompt-templates",
    "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md",
    "src/skills",
    "src/snip-filters",
    "src/ui/theme/catppuccin-mocha.json",
];

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {Object} CompileOptions
 * @property {string} [output]
 * @property {string} [target]
 * @property {boolean} [reload]
 */

/**
 * Run a command and return success + stdout.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<CommandResult>}
 */
async function runCmd(cmd, args) {
    const command = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
    const { success, stdout, stderr } = await command.output();
    return {
        success,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

/**
 * @param {CompileOptions} [options]
 * @returns {string[]}
 */
export function buildCompileArgs(options = {}) {
    const output = options.output || "./bin/wld";
    const args = [
        "compile",
        "--output",
        output,
        "-A",
        "--no-check",
        "--unstable-no-legacy-abort",
        "--exclude-unused-npm",
        "--bundle",
        "--minify",
        "--app-name",
        "wld",
    ];

    if (options.reload) args.push("--reload");
    if (options.target) args.push("--target", options.target);

    for (const path of STATIC_INCLUDE_PATHS) {
        args.push("--include", path);
    }

    args.push("src/cli.js");

    return args;
}

/**
 * @param {string[]} args
 * @returns {CompileOptions}
 */
export function parseCompileOptions(args) {
    /** @type {CompileOptions} */
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--reload") {
            options.reload = true;
            continue;
        }
        if (arg === "--output" || arg === "--target") {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
            if (arg === "--output") options.output = value;
            else options.target = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("--output=")) {
            options.output = arg.slice("--output=".length);
            continue;
        }
        if (arg.startsWith("--target=")) {
            options.target = arg.slice("--target=".length);
            continue;
        }
        throw new Error(`Unknown compile option: ${arg}`);
    }
    return options;
}

/**
 * Keep local and release artifacts on the same Deno compiler/runtime.
 *
 * @param {string} [version]
 */
export function assertCompileDenoVersion(version = Deno.version.deno) {
    if (version !== DENO_COMPILE_VERSION) {
        throw new Error(
            `RunWield binaries must be compiled with Deno ${DENO_COMPILE_VERSION}; current Deno is ${version}.`,
        );
    }
}

/**
 * @param {string[]} [args]
 * @returns {Promise<void>}
 */
export async function main(args = Deno.args) {
    assertCompileDenoVersion();
    const options = parseCompileOptions(args);
    const output = options.output || "./bin/wld";

    const versionBuild = await runCmd("deno", ["run", "-A", "scripts/write-version.js"]);
    if (!versionBuild.success) throw new Error(versionBuild.stderr || "Version generation failed.");

    const workspaceBuild = await runCmd("deno", ["task", "workspace:build"]);
    console.log(workspaceBuild.stdout);
    if (!workspaceBuild.success) {
        throw new Error(workspaceBuild.stderr || "Workspace build failed.");
    }

    const workspaceRuntimeBuild = await runCmd("deno", ["run", "-A", "scripts/build-workspace-runtime.js"]);
    console.log(workspaceRuntimeBuild.stdout);
    if (!workspaceRuntimeBuild.success) {
        throw new Error(workspaceRuntimeBuild.stderr || "Workspace runtime build failed.");
    }

    await Deno.mkdir(dirname(output), { recursive: true });
    const compile = await runCmd("deno", buildCompileArgs(options));

    console.log(compile.stdout);

    if (!compile.success) {
        throw new Error(compile.stderr || "Deno compile failed.");
    }
}

if (import.meta.main) {
    await main();
}
