/**
 * Run a command and return success + stdout.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string }>}
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

await runCmd("deno", ["run", "-A", "scripts/write-version.js"]);

const compile = await runCmd("deno", [
    "compile",
    "-A",

    "--include",
    "src/ui/workspace/static/",

    "--include",
    "src/agent-definitions",

    "--include",
    "src/agent-definitions/workflow-prompts",
    // "--include",
    // "src/agent-definitions/workflow-prompts/init-agent-prompt.md",
    // "--include",
    // "src/agent-definitions/workflow-prompts/slicer-prompt.md",
    // "--include",
    // "src/agent-definitions/workflow-prompts/reviewer-prompt.md",

    "--include",
    "src/prompt-templates",

    "--include",
    "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md",

    "--include",
    "src/skills",

    "--include",
    "src/snip-filters",

    "--include",
    "src/ui/theme/catppuccin-mocha.json",

    "--output",
    "./bin/wld",
    "src/cli.js",
]);

console.log(compile.stdout);

if (!compile.success) {
    console.error(compile.stderr);
    Deno.exit(1);
}
