/**
 * Run local Homebrew checks for a rendered tap.
 */

import { resolve } from "@std/path";

const TAP_NAME = "gandazgul/tap";

function usage() {
    return "Usage: package-homebrew-check.js --tap <directory>";
}

/** @param {string[]} args */
function parseArgs(args) {
    let tap = "";
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--tap") tap = args[++index] || "";
        else throw new Error(`Unknown package:homebrew:check option: ${arg}\n${usage()}`);
    }
    if (!tap) throw new Error(usage());
    return { tap };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {boolean} allowFailure
 */
async function run(command, args, cwd, allowFailure = false) {
    const child = new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await child.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!output.success && !allowFailure) {
        throw new Error(`${command} ${args.join(" ")} failed with exit code ${output.code}:\n${stdout}${stderr}`);
    }
    return { success: output.success, stdout, stderr };
}

/** @param {string} tap */
async function ensureGitTap(tap) {
    const gitDir = await Deno.stat(`${tap}/.git`).then((stat) => stat.isDirectory).catch(() => false);
    if (gitDir) return;
    await run("git", ["init"], tap);
    await run("git", ["add", "."], tap);
    await run("git", [
        "-c",
        "user.name=RunWield",
        "-c",
        "user.email=runwield@example.invalid",
        "commit",
        "-m",
        "Prepare tap",
    ], tap);
}

/** @param {string} tap */
async function assertNoConflictingTap(tap) {
    const existing = await run("brew", ["--repo", TAP_NAME], tap, true);
    if (!existing.success) return;
    const existingPath = resolve(existing.stdout.trim());
    if (existingPath !== resolve(tap)) {
        throw new Error(`Homebrew tap ${TAP_NAME} already points at ${existingPath}. Untap it or pass that path.`);
    }
}

export async function main(args = Deno.args) {
    const { tap } = parseArgs(args);
    if (Deno.build.os !== "darwin") {
        throw new Error("Homebrew package checks must run on macOS.");
    }
    await Deno.stat(`${tap}/Formula/wld.rb`);
    await Deno.stat(`${tap}/Formula/mnemoteca.rb`);
    await ensureGitTap(tap);
    await assertNoConflictingTap(tap);
    await run("brew", ["tap", TAP_NAME, `file://${resolve(tap)}`], tap);
    await run("brew", ["audit", "--strict", "--formula", "gandazgul/tap/wld", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["install", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["install", "gandazgul/tap/wld"], tap);
    await run("brew", ["test", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["test", "gandazgul/tap/wld"], tap);
    console.log(
        "Homebrew formulas audited, installed, and tested. Now exercise helper workflows with disposable user data.",
    );
}

if (import.meta.main) await main();
