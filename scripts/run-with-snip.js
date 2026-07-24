#!/usr/bin/env -S deno run -A

const [commandName, ...commandArgs] = Deno.args;

if (!commandName) {
    console.error("usage: run-with-snip <command> [args...]");
    Deno.exit(64);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<number>}
 */
async function runInherited(command, args) {
    const child = new Deno.Command(command, {
        args,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    }).spawn();
    const status = await child.status;
    return status.code ?? 1;
}

try {
    Deno.exit(await runInherited("snip", ["run", "--", commandName, ...commandArgs]));
} catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    Deno.exit(await runInherited(commandName, commandArgs));
}
