/**
 * Internal package smoke checks that must execute inside the packaged CLI.
 */

import { join } from "@std/path";
import { WORK_RECORDS_DIR_NAME } from "../../constants.js";
import { publishExecutionWorktreeIsolated } from "../../shared/isolated-publication.ts";

/** @param {string} name */
function requiredEnv(name: string): string {
    const value = Deno.env.get(name) || "";
    if (!value) throw new Error(`Package smoke requires ${name}.`);
    return value;
}

async function run(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
    console.log(`[RunWield package smoke] ${command} ${args.join(" ")}`);
    const child = new Deno.Command(command, {
        args,
        cwd: options.cwd,
        env: options.env,
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        if (Deno.build.os === "windows") {
            new Deno.Command("taskkill", {
                args: ["/PID", String(child.pid), "/T", "/F"],
                stdout: "null",
                stderr: "null",
            }).output().catch(() => {});
            return;
        }
        try {
            child.kill();
        } catch {
            // Process already exited.
        }
    }, 300_000);
    try {
        const result = await child.output();
        const decoder = new TextDecoder();
        const stdout = decoder.decode(result.stdout);
        const stderr = decoder.decode(result.stderr);
        if (timedOut) throw new Error(`${command} ${args.join(" ")} timed out\n${stdout}${stderr}`);
        if (!result.success) throw new Error(`${command} ${args.join(" ")} failed\n${stdout}${stderr}`);
        return { stdout, stderr };
    } finally {
        clearTimeout(timeout);
    }
}

async function checkCoreHelperFlows(env: Record<string, string>): Promise<void> {
    const localAppData = requiredEnv("LOCALAPPDATA");
    const memoryText = `runwield windows package smoke ${Date.now()}`;
    await run("mnemoteca", ["setup"], { env });
    await run("mnemoteca", ["init", "--name", "runwield"], { env });
    await run("mnemoteca", ["add", memoryText, "--tag", "runwield-windows-package-smoke"], { env });
    const memorySearch = await run("mnemoteca", ["search", memoryText], { env });
    if (!memorySearch.stdout.includes(memoryText)) {
        throw new Error("Packaged Mnemoteca add/search did not return the smoke memory.");
    }

    const project = join(localAppData, "core-flow-project");
    await Deno.mkdir(join(project, "src"), { recursive: true });
    await Deno.mkdir(join(project, WORK_RECORDS_DIR_NAME), { recursive: true });
    await run("git", ["init", "-b", "main"], { cwd: project, env });
    await Deno.writeTextFile(
        join(project, "src", "smoke.ts"),
        "export function runwieldWindowsPackageSmoke() { return 1; }\n",
    );
    await run("cymbal", ["index", "."], { cwd: project, env });
    const codeSearch = await run("cymbal", ["--no-federate", "search", "runwieldWindowsPackageSmoke"], {
        cwd: project,
        env,
    });
    if (!codeSearch.stdout.includes("runwieldWindowsPackageSmoke")) {
        throw new Error("Packaged Cymbal index/search did not find the smoke symbol.");
    }

    await Deno.writeTextFile(
        join(project, WORK_RECORDS_DIR_NAME, "package-smoke.md"),
        [
            "---",
            'kind: "work_record"',
            'recordId: "11111111-1111-4111-8111-111111111111"',
            'status: "approved"',
            'scope: "planned_change"',
            'workKind: "MAINTENANCE"',
            'origin: "internal"',
            'completionMode: "verified"',
            'createdAt: "2026-01-01T00:00:00.000Z"',
            "provenance:",
            "    sourcePlans:",
            '        - "22222222-2222-4222-8222-222222222222"',
            "---",
            "# Windows package smoke",
            "",
            "## Summary",
            "",
            "Bundled helper path smoke.",
        ].join("\n"),
    );
    const indexResult = await run(Deno.execPath(), ["wr", "index", "rebuild"], { cwd: project, env });
    if (!indexResult.stdout.includes("canonical records: 1") || !indexResult.stdout.includes("indexed: 1")) {
        throw new Error(`Packaged Work Record indexing did not index the fixture:\n${indexResult.stdout}`);
    }
    const wrSearch = await run(Deno.execPath(), ["wr", "search", "Bundled helper path smoke"], { cwd: project, env });
    if (
        !wrSearch.stdout.includes("11111111-1111-4111-8111-111111111111") ||
        !wrSearch.stdout.includes("Windows package smoke")
    ) {
        throw new Error(`Packaged Work Record search did not retrieve the fixture:\n${wrSearch.stdout}`);
    }

    const server = Deno.serve(
        { port: 0, hostname: "127.0.0.1", onListen() {} },
        () => new Response("package smoke page"),
    );
    try {
        const url = `http://127.0.0.1:${server.addr.port}/smoke`;
        const page = await run("ketch", ["scrape", url], { env });
        if (!page.stdout.includes("package smoke page")) {
            throw new Error("Packaged Ketch page fetch did not return the smoke page.");
        }
        await run("agent-browser", ["install"], { env });
        await run("agent-browser", ["open", url], { env });
        const snapshot = await run("agent-browser", ["snapshot"], { env });
        if (!snapshot.stdout.includes("package smoke page")) {
            throw new Error("Packaged agent-browser snapshot did not include the smoke page.");
        }
        await run("agent-browser", ["close", "--all"], { env });
    } finally {
        await server.shutdown();
    }
}

async function checkPublicationFlow(env: Record<string, string>): Promise<void> {
    const localAppData = requiredEnv("LOCALAPPDATA");
    const project = join(localAppData, "publication-project");
    const remote = join(localAppData, "publication-remote.git");
    const publicationRoot = join(localAppData, "publication-worktree-root");
    await Deno.mkdir(project, { recursive: true });
    await run("git", ["init", "-b", "main"], { cwd: project, env });
    await run("git", ["config", "user.email", "runwield-package-check@example.invalid"], { cwd: project, env });
    await run("git", ["config", "user.name", "RunWield Package Check"], { cwd: project, env });
    await Deno.writeTextFile(join(project, ".gitignore"), ".wld/\n");
    await Deno.writeTextFile(join(project, "published.txt"), "base package check\n");
    await run("git", ["add", ".gitignore", "published.txt"], { cwd: project, env });
    await run("git", ["commit", "-m", "Initialize package publication fixture"], { cwd: project, env });
    await run("git", ["init", "--bare", remote], { env });
    await run("git", ["remote", "add", "origin", remote], { cwd: project, env });
    await run("git", ["push", "-u", "origin", "main"], { cwd: project, env });
    await run("git", ["checkout", "-b", "runwield/package-publication-smoke"], { cwd: project, env });
    await Deno.writeTextFile(join(project, "published.txt"), "published by package check\n");
    await run("git", ["commit", "-am", "Apply package publication fixture"], { cwd: project, env });
    const sealedExecutionCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: project, env })).stdout.trim();
    const result = await publishExecutionWorktreeIsolated({
        projectRoot: project,
        executionCwd: project,
        executionBranch: "runwield/package-publication-smoke",
        targetBranch: "main",
        planName: "package-publication-smoke",
        sealedExecutionCommit,
        allowedPlanPaths: [],
        publicationRoot,
    });
    if (result.publicationMode !== "remote") throw new Error("Publication smoke did not use the remote path.");
    const remoteText = await run("git", ["show", "main:published.txt"], { cwd: remote, env });
    if (!remoteText.stdout.includes("published by package check")) {
        throw new Error("Publication smoke did not deliver the expected file content.");
    }
}

export async function runPackageSmokeCommand(argv: string[]): Promise<void> {
    const env = Deno.env.toObject();
    const [subcommand] = argv;
    if (subcommand === "core-flows") {
        await checkCoreHelperFlows(env);
        console.log("[RunWield] Packaged core helper flows passed.");
        return;
    }
    if (subcommand === "publication") {
        await checkPublicationFlow(env);
        console.log("[RunWield] Packaged publication flow passed.");
        return;
    }
    throw new Error("Usage: wld package-smoke <core-flows|publication>");
}
