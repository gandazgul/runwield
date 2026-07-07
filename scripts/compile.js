/**
 * Build the standalone RunWield binary.
 */

const STATIC_INCLUDE_PATHS = [
    "src/ui/workspace/static/",
    "src/agent-definitions",
    "src/prompt-templates",
    "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md",
    "src/skills",
    "src/snip-filters",
    "src/ui/theme/catppuccin-mocha.json",
];

const PLANNOTATOR_SERVER_EXPORT = "@gandazgul/plannotator-pi-extension-compiled/server";
const PLANNOTATOR_SERVER_INCLUDE = "npm:@gandazgul/plannotator-pi-extension-compiled@^0.21.4/server";
const PLANNOTATOR_ASSETS_INCLUDE = "npm:@gandazgul/plannotator-pi-extension-compiled@^0.21.4/assets";
const PLANNOTATOR_REVIEW_EDITOR_RELATIVE_PATH = "../review-editor.html";

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {Object} CompileArgsOptions
 * @property {"--include" | "--include-as-is"} staticIncludeFlag
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
 * Choose the best passive-resource include flag supported by the active Deno CLI.
 * Deno 2.9 docs advertise `--include-as-is`, but some 2.9.x binaries do not expose it yet.
 *
 * @param {string} compileHelpText
 * @returns {"--include" | "--include-as-is"}
 */
export function selectStaticIncludeFlag(compileHelpText) {
    return compileHelpText.includes("--include-as-is") ? "--include-as-is" : "--include";
}

/**
 * @param {CompileArgsOptions} options
 * @returns {string[]}
 */
export function buildCompileArgs({ staticIncludeFlag, reviewEditorHtmlPath }) {
    const args = [
        "compile",
        "-A",
        "--no-check",
        "--bundle",
        "--minify",
        "--app-name",
        "wld",
    ];

    for (const path of STATIC_INCLUDE_PATHS) {
        args.push(staticIncludeFlag, path);
    }

    args.push("--include", PLANNOTATOR_SERVER_INCLUDE);
    args.push("--include", PLANNOTATOR_ASSETS_INCLUDE);

    if (reviewEditorHtmlPath) {
        args.push(staticIncludeFlag, reviewEditorHtmlPath);
    }

    args.push(
        "--output",
        "./bin/wld",
        "src/cli.js",
    );

    return args;
}

/**
 * @returns {Promise<string>}
 */
export async function getDenoCompileHelp() {
    const result = await runCmd("deno", ["compile", "--help"]);
    return `${result.stdout}\n${result.stderr}`;
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

    const compileHelp = await getDenoCompileHelp();
    const staticIncludeFlag = selectStaticIncludeFlag(compileHelp);
    if (staticIncludeFlag === "--include") {
        console.warn(
            "[compile] Active Deno does not support --include-as-is; using --include for bundled static resources.",
        );
    }

    const reviewEditorHtmlPath = resolvePlannotatorReviewEditorHtmlPath();
    const compile = await runCmd("deno", buildCompileArgs({ staticIncludeFlag, reviewEditorHtmlPath }));

    console.log(compile.stdout);

    if (!compile.success) {
        console.error(compile.stderr);
        Deno.exit(1);
    }
}

if (import.meta.main) {
    await main();
}
