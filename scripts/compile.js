/**
 * Build the standalone RunWield binary.
 */

const STATIC_INCLUDE_PATHS = [
    "src/ui/workspace/static/",
    "src/ui/design-system/tokens.css",
    "src/ui/design-system/components.css",
    "logo.svg",
    "dist/workspace/",
    "src/agent-definitions",
    "src/prompt-templates",
    "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md",
    "src/skills",
    "src/snip-filters",
    "src/ui/theme/catppuccin-mocha.json",
];

const PLANNOTATOR_SERVER_EXPORT = "@gandazgul/plannotator-pi-extension-compiled/server";
const PLANNOTATOR_SERVER_INCLUDE = "npm:@gandazgul/plannotator-pi-extension-compiled@^0.22.0/server";
const PLANNOTATOR_ASSETS_INCLUDE = "npm:@gandazgul/plannotator-pi-extension-compiled@^0.22.0/assets";
const PLANNOTATOR_REVIEW_EDITOR_RELATIVE_PATH = "../review-editor.html";

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {Object} CompileArgsOptions
 * @property {string | null | undefined} [reviewEditorHtmlPath]
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
 * @param {CompileArgsOptions} options
 * @returns {string[]}
 */
export function buildCompileArgs({ reviewEditorHtmlPath }) {
    // Do not pass --bundle here. The Workspace server resolves Astro's built
    // entry and static resources relative to module URLs at runtime; Deno's
    // compile bundler rewrites import.meta.url to a temporary bundle path,
    // which makes compiled binaries miss the embedded Workspace build. Keep
    // the binary self-extracting so those embedded resources exist beside the
    // preserved source module paths when the compiled app starts.
    const args = [
        "compile",
        "--output",
        "./bin/wld",
        "-A",
        "--no-check",
        "--unstable-no-legacy-abort",
        "--reload",
        "--exclude-unused-npm",
        "--self-extracting",
        "--app-name",
        "wld",
    ];

    for (const path of STATIC_INCLUDE_PATHS) {
        args.push("--include", path);
    }

    args.push("--include", PLANNOTATOR_SERVER_INCLUDE);
    args.push("--include", PLANNOTATOR_ASSETS_INCLUDE);

    if (reviewEditorHtmlPath) {
        args.push("--include", reviewEditorHtmlPath);
    }

    args.push("src/cli.js");

    return args;
}

/**
 * Resolve the package HTML asset that `src/shared/workflow/code-review.js` reads at runtime.
 * It is not currently exposed as a JavaScript string export by the package, so compile must
 * embed this file explicitly when bundling avoids shipping the entire npm tree.
 *
 * @returns {string}
 */
export function resolvePlannotatorReviewEditorHtmlPath() {
    return new URL(PLANNOTATOR_REVIEW_EDITOR_RELATIVE_PATH, import.meta.resolve(PLANNOTATOR_SERVER_EXPORT)).pathname;
}

/**
 * @returns {Promise<void>}
 */
export async function main() {
    await runCmd("deno", ["run", "-A", "scripts/write-version.js"]);

    const workspaceBuild = await runCmd("deno", ["task", "workspace:build"]);
    console.log(workspaceBuild.stdout);
    if (!workspaceBuild.success) {
        console.error(workspaceBuild.stderr);
        Deno.exit(1);
    }

    const reviewEditorHtmlPath = resolvePlannotatorReviewEditorHtmlPath();
    const compile = await runCmd("deno", buildCompileArgs({ reviewEditorHtmlPath }));

    console.log(compile.stdout);

    if (!compile.success) {
        console.error(compile.stderr);
        Deno.exit(1);
    }
}

if (import.meta.main) {
    await main();
}
