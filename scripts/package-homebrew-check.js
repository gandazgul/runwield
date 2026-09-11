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
    if (!gitDir) await run("git", ["init"], tap);
    await run("git", ["add", "."], tap);
    const status = await run("git", ["status", "--porcelain"], tap);
    if (!status.stdout.trim()) return;
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

/**
 * @param {string} existingPath
 * @param {string} tap
 */
async function isCloneOfTap(existingPath, tap) {
    const origin = await run("git", ["-C", existingPath, "config", "--get", "remote.origin.url"], tap, true);
    if (!origin.success) return false;
    const expected = `file://${resolve(tap)}`;
    return origin.stdout.trim() === expected ||
        resolve(origin.stdout.trim().replace(/^file:\/\//, "")) === resolve(tap);
}

/** @param {string} path */
async function fileSha256(path) {
    const hash = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} fromTap
 * @param {string} toTap
 */
async function copyRenderedTapFiles(fromTap, toTap) {
    await Deno.mkdir(`${toTap}/Formula`, { recursive: true });
    for (const path of ["Formula/wld.rb", "Formula/mnemoteca.rb", "README.md", "runwield-homebrew-package.json"]) {
        await Deno.copyFile(`${fromTap}/${path}`, `${toTap}/${path}`);
    }
}

/** @param {string} tap */
async function registeredTapPath(tap) {
    const existing = await run("brew", ["--repo", TAP_NAME], tap, true);
    if (!existing.success) return "";
    const existingPath = resolve(existing.stdout.trim());
    if (existingPath !== resolve(tap) && !(await isCloneOfTap(existingPath, tap))) {
        throw new Error(`Homebrew tap ${TAP_NAME} already points at ${existingPath}. Untap it or pass that path.`);
    }
    if (existingPath !== resolve(tap)) await copyRenderedTapFiles(tap, existingPath);
    return existingPath;
}

/** @param {string} tap */
async function readManifest(tap) {
    const text = await Deno.readTextFile(`${tap}/runwield-homebrew-package.json`);
    return JSON.parse(text);
}

/**
 * @param {string} tap
 * @param {string} wldTag
 */
async function assertInstalledRunWieldPackage(tap, wldTag) {
    const prefix = (await run("brew", ["--prefix", "gandazgul/tap/wld"], tap)).stdout.trim();
    const metadata = JSON.parse(await Deno.readTextFile(`${prefix}/libexec/runwield-install.json`));
    if (metadata.packageManager !== "homebrew" || metadata.packageIdentifier !== "gandazgul/tap/wld") {
        throw new Error("Installed RunWield artifact is missing Homebrew ownership metadata.");
    }
    if (metadata.version !== wldTag || metadata.updateCommand !== "brew upgrade gandazgul/tap/wld") {
        throw new Error(`Installed RunWield metadata does not match ${wldTag}.`);
    }
    const executable = `${prefix}/bin/wld`;
    const version = (await run(executable, ["--version"], tap)).stdout;
    if (!version.includes(wldTag)) throw new Error(`Installed wld does not report ${wldTag}: ${version}`);
    return executable;
}

/**
 * @param {string} tap
 * @param {string} executable
 */
async function assertPackageUpdateAliases(tap, executable) {
    for (const alias of ["update", "upgrade"]) {
        const output = await run(executable, [alias], tap);
        if (!output.stdout.includes("brew upgrade gandazgul/tap/wld")) {
            throw new Error(`wld ${alias} did not report the Homebrew upgrade command.`);
        }
    }
}

export async function main(args = Deno.args) {
    const { tap } = parseArgs(args);
    if (Deno.build.os !== "darwin") throw new Error("Homebrew package checks must run on macOS.");
    await Deno.stat(`${tap}/Formula/wld.rb`);
    await Deno.stat(`${tap}/Formula/mnemoteca.rb`);
    const manifest = await readManifest(tap);
    if (!manifest.wldTag || !manifest.mnemotecaTag) {
        throw new Error("Package manifest must name wldTag and mnemotecaTag.");
    }
    await ensureGitTap(tap);
    const registeredTap = await registeredTapPath(tap);
    if (!registeredTap) await run("brew", ["tap", TAP_NAME, `file://${resolve(tap)}`], tap);
    await run("brew", ["audit", "--strict", "--formula", "gandazgul/tap/wld", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["install", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["install", "gandazgul/tap/wld"], tap);
    const executable = await assertInstalledRunWieldPackage(tap, manifest.wldTag);
    const installedHash = await fileSha256(executable);
    await assertPackageUpdateAliases(tap, executable);
    if (await fileSha256(executable) !== installedHash) {
        throw new Error("wld update aliases changed the installed package bytes.");
    }
    await run("brew", ["test", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["test", "gandazgul/tap/wld"], tap);
    await run("brew", ["upgrade", "gandazgul/tap/mnemoteca", "gandazgul/tap/wld"], tap);
    const upgradedExecutable = await assertInstalledRunWieldPackage(tap, manifest.wldTag);
    if (await fileSha256(upgradedExecutable) !== installedHash) {
        throw new Error("brew upgrade changed the installed package bytes.");
    }
    await run("brew", ["uninstall", "gandazgul/tap/wld"], tap);
    const removed = await Deno.stat(upgradedExecutable).then(() => false).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return true;
        throw error;
    });
    if (!removed) throw new Error("brew uninstall left the verified wld executable installed.");
    await run("brew", ["uninstall", "gandazgul/tap/mnemoteca"], tap);
    await run("brew", ["install", "gandazgul/tap/wld"], tap);
    const reinstalledExecutable = await assertInstalledRunWieldPackage(tap, manifest.wldTag);
    if (await fileSha256(reinstalledExecutable) !== installedHash) {
        throw new Error("brew reinstall did not restore the same package bytes.");
    }
    console.log("Homebrew formulas audited, installed, tested, upgraded, uninstalled, and ownership-checked.");
}

if (import.meta.main) await main();
