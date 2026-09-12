/**
 * Native Windows package smoke checks for a built RunWield ZIP.
 */

import { basename, join } from "@std/path";

function usage() {
    return "Usage: package-windows-check.js --package <wld-*-windows-x64.zip>";
}

/** @param {string[]} args */
function parseArgs(args) {
    const options = { packagePath: "" };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--package") options.packagePath = args[++index] || "";
        else throw new Error(`Unknown package:windows:check option: ${arg}\n${usage()}`);
    }
    if (!options.packagePath) throw new Error(usage());
    return options;
}

/** @param {string} command @param {string[]} args @param {{ cwd?: string, env?: Record<string, string> }} [options] */
async function run(command, args, options = {}) {
    const result = await new Deno.Command(command, {
        args,
        cwd: options.cwd,
        env: options.env,
        stdout: "piped",
        stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(result.stdout);
    const stderr = decoder.decode(result.stderr);
    if (!result.success) throw new Error(`${command} ${args.join(" ")} failed\n${stdout}${stderr}`);
    return { stdout, stderr };
}

async function main(args = Deno.args) {
    const options = parseArgs(args);
    if (Deno.build.os !== "windows") throw new Error("package:windows:check must run on native Windows.");
    const root = await Deno.makeTempDir({ prefix: "runwield-windows-check-" });
    try {
        const extract = join(root, "Run Wield Package");
        await Deno.mkdir(extract, { recursive: true });
        await run("powershell", [
            "-NoProfile",
            "-Command",
            `Expand-Archive -LiteralPath ${JSON.stringify(options.packagePath)} -DestinationPath ${
                JSON.stringify(extract)
            } -Force`,
        ]);
        const exe = join(extract, "wld.exe");
        const metadata = JSON.parse(await Deno.readTextFile(join(extract, "runwield-install.json")));
        if (metadata.packageManager !== "winget" || metadata.packageIdentifier !== "Gandazgul.RunWield") {
            throw new Error("Package metadata does not identify Gandazgul.RunWield WinGet ownership.");
        }
        const home = join(root, "User Profile");
        await Deno.mkdir(home, { recursive: true });
        const cleanEnv = {
            HOME: "",
            USERPROFILE: home,
            APPDATA: join(home, "AppData", "Roaming"),
            LOCALAPPDATA: join(home, "AppData", "Local"),
            PATH: Deno.env.get("SystemRoot") ? `${Deno.env.get("SystemRoot")}\\System32` : Deno.env.get("PATH") || "",
        };
        const version = await run(exe, ["--version"], { env: cleanEnv });
        const help = await run(exe, ["--help"], { env: cleanEnv });
        const update = await run(exe, ["update", "--rc"], { env: cleanEnv });
        if (!version.stdout.toLowerCase().includes("runwield")) {
            throw new Error("wld --version did not identify RunWield.");
        }
        if (!help.stdout.toLowerCase().includes("usage")) throw new Error("wld --help did not print help.");
        if (!update.stdout.includes("winget upgrade --id Gandazgul.RunWield --exact")) {
            throw new Error("wld update did not print the WinGet upgrade command.");
        }
        await run("cmd", ["/c", exe, "--version"], { env: cleanEnv });
        console.log(`${basename(options.packagePath)} passed native Windows package smoke checks.`);
    } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
}

if (import.meta.main) await main();
