import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";

import {
    createCandidate,
    createStable,
    expectedReleaseAssetNames,
    nextCandidateTag,
    parseReleaseArgs,
    parseReleaseTag,
    previousStableTag,
    promoteCandidate,
    releaseMetadataForTag,
    resolveRemoteTagCommit,
    stableTagForCandidate,
} from "./release.js";

Deno.test("parseReleaseTag accepts WLD stable and candidate tags", () => {
    assertEquals(parseReleaseTag("v1.2.3"), {
        tag: "v1.2.3",
        major: 1,
        minor: 2,
        patch: 3,
        rc: undefined,
        kind: "stable",
        stableTag: "v1.2.3",
    });
    assertEquals(parseReleaseTag("v1.2.3-rc.10").rc, 10);
    assertEquals(stableTagForCandidate("v1.2.3-rc.1"), "v1.2.3");
});

Deno.test("parseReleaseTag rejects unsafe or unsupported tags", () => {
    for (
        const tag of [
            "1.2.3",
            "v1.2.3-beta.1",
            "v1.2.3-rc.0",
            "v01.2.3",
            "v1.02.3",
            "v1.2.03",
            "v1.2.3-rc.01",
            "v1.2.3/bad",
            "v1.2.3\n",
        ]
    ) {
        assertThrows(() => parseReleaseTag(tag), Error);
    }
});

Deno.test("candidate progression and previous stable ignore Candidate tags", () => {
    const tags = ["v0.8.9", "v0.8.10", "v0.8.11-rc.1", "v0.8.11-rc.10", "v0.8.11"];
    assertEquals(previousStableTag(tags), "v0.8.11");
    assertEquals(nextCandidateTag(tags), "v0.8.12-rc.1");
});

Deno.test("releaseMetadataForTag emits GitHub channel metadata", () => {
    assertEquals(releaseMetadataForTag("v1.2.3-rc.1"), {
        tag: "v1.2.3-rc.1",
        kind: "candidate",
        buildVersion: "v1.2.3-rc.1",
        prerelease: true,
        makeLatest: false,
    });
    assertEquals(releaseMetadataForTag("v1.2.3"), {
        tag: "v1.2.3",
        kind: "stable",
        buildVersion: "v1.2.3",
        prerelease: false,
        makeLatest: true,
    });
});

Deno.test("expectedReleaseAssetNames covers all WLD release assets", () => {
    const names = expectedReleaseAssetNames("v1.2.3-rc.1");
    assertEquals(names.includes("wld-v1.2.3-rc.1-linux-x64.tar.gz"), true);
    assertEquals(names.includes("wld-v1.2.3-rc.1-windows-x64.tar.zst.sha256"), true);
    assertEquals(names.includes("SHA256SUMS"), true);
    assertEquals(names.includes("config.schema.json"), true);
});

Deno.test("parseReleaseArgs keeps command contracts explicit", () => {
    assertEquals(parseReleaseArgs(["candidate", "--tag", "v1.2.3-rc.1", "--dry-run"]), {
        command: "candidate",
        tag: "v1.2.3-rc.1",
        dryRun: true,
    });
    assertEquals(parseReleaseArgs(["promote", "--candidate", "v1.2.3-rc.1"]), {
        command: "promote",
        candidate: "v1.2.3-rc.1",
        dryRun: false,
    });
});

/**
 * @param {Record<string, { success?: boolean, code?: number, stdout?: string, stderr?: string }>} responses
 */
function depsForCommands(responses) {
    /** @type {Array<{ command: string, args: string[] }>} */
    const calls = [];
    const deps = {
        log() {},
        makeTempDir: () => Promise.resolve("/tmp/wld-release-test"),
        remove: () => Promise.resolve(),
        /**
         * @param {string} command
         * @param {string[]} args
         */
        run(command, args) {
            calls.push({ command, args });
            const key = `${command} ${args.join(" ")}`;
            const defaultResponse = (() => {
                if (command === "git" && args.join(" ") === "fetch origin main") return { stdout: "" };
                if (command === "git" && args.join(" ") === "rev-parse origin/main") {
                    return responses["git rev-parse @{u}"] || { stdout: "" };
                }
                if (command === "gh" && args[0] === "release" && args[1] === "view" && args.includes("id")) {
                    return { success: false, code: 1, stderr: "release not found" };
                }
                return { success: true, code: 0, stdout: "", stderr: "" };
            })();
            const response = responses[key] || defaultResponse;
            return Promise.resolve({
                success: response.success ?? true,
                code: response.code ?? 0,
                stdout: response.stdout ?? "",
                stderr: response.stderr ?? "",
            });
        },
    };
    return { calls, deps };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
async function runCommand(command, args, options = {}) {
    const output = await new Deno.Command(command, { args, cwd: options.cwd, stdout: "piped", stderr: "piped" })
        .output();
    const decoder = new TextDecoder();
    if (!output.success) {
        throw new Error(
            `${command} ${args.join(" ")} failed: ${decoder.decode(output.stderr) || decoder.decode(output.stdout)}`,
        );
    }
    return decoder.decode(output.stdout);
}

async function createReleaseRepo() {
    const root = await Deno.makeTempDir({ prefix: "wld-release-repo-" });
    const remote = `${root}/remote.git`;
    const repo = `${root}/repo`;
    await runCommand("git", ["init", "--bare", remote]);
    await runCommand("git", ["init", "-b", "main", repo]);
    await runCommand("git", ["config", "user.email", "release-test@example.com"], { cwd: repo });
    await runCommand("git", ["config", "user.name", "Release Test"], { cwd: repo });
    await Deno.writeTextFile(`${repo}/file.txt`, "initial\n");
    await runCommand("git", ["add", "file.txt"], { cwd: repo });
    await runCommand("git", ["commit", "-m", "initial"], { cwd: repo });
    await runCommand("git", ["remote", "add", "origin", remote], { cwd: repo });
    await runCommand("git", ["push", "-u", "origin", "main"], { cwd: repo });
    return { root, repo, remote };
}

/** @param {string} repo */
function repoDeps(repo) {
    /** @type {Array<{ command: string, args: string[] }>} */
    const calls = [];
    return {
        calls,
        deps: {
            log() {},
            error() {},
            /**
             * @param {string} command
             * @param {string[]} args
             * @param {{ cwd?: string, env?: Record<string, string> }} [options]
             */
            async run(command, args, options = {}) {
                calls.push({ command, args });
                if (command === "deno" && args.join(" ") === "task submodules:check:remote") {
                    return { success: true, code: 0, stdout: "submodules ok\n", stderr: "" };
                }
                if (command === "deno" && args[0] === "task" && args[1] === "release:check") {
                    return { success: true, code: 0, stdout: "release ok\n", stderr: "" };
                }
                if (command === "gh") {
                    const tag = args[2];
                    if (args.includes("id")) {
                        return { success: false, code: 1, stdout: "", stderr: "release not found" };
                    }
                    const assets = expectedReleaseAssetNames(tag).map((name) => ({ name }));
                    return {
                        success: true,
                        code: 0,
                        stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
                        stderr: "",
                    };
                }
                const output = await new Deno.Command(command, {
                    args,
                    cwd: options.cwd || repo,
                    env: options.env,
                    stdout: "piped",
                    stderr: "piped",
                }).output();
                const decoder = new TextDecoder();
                return {
                    success: output.success,
                    code: output.code,
                    stdout: decoder.decode(output.stdout),
                    stderr: decoder.decode(output.stderr),
                };
            },
        },
    };
}

Deno.test("resolveRemoteTagCommit peels annotated remote tags to the source commit", async () => {
    const fixture = await createReleaseRepo();
    try {
        const sourceCommit = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: fixture.repo })).trim();
        await runCommand("git", ["tag", "-a", "v1.2.3-rc.1", "-m", "candidate"], { cwd: fixture.repo });
        const tagObject = (await runCommand("git", ["rev-parse", "v1.2.3-rc.1"], { cwd: fixture.repo })).trim();
        await runCommand("git", ["push", "origin", "refs/tags/v1.2.3-rc.1"], { cwd: fixture.repo });
        const { deps } = repoDeps(fixture.repo);

        assertEquals(await resolveRemoteTagCommit(deps, "v1.2.3-rc.1"), sourceCommit);
        assertEquals(sourceCommit === tagObject, false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("createCandidate dry-run preflights and avoids tag, push, and host release commands", async () => {
    const { deps, calls } = depsForCommands({
        "git branch --show-current": { stdout: "main\n" },
        "git status --porcelain": { stdout: "" },
        "git rev-parse HEAD": { stdout: "abc123\n" },
        "git rev-parse @{u}": { stdout: "abc123\n" },
        "git tag --list v*": { stdout: "v1.2.2\n" },
        "git ls-remote --tags origin refs/tags/v*": { stdout: "" },
        "deno task submodules:check:remote": { stdout: "ok\n" },
        "git rev-parse v1.2.3-rc.1^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1": { stdout: "" },
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
    });

    await createCandidate(deps, "v1.2.3-rc.1", true);

    assertEquals(
        calls.some((call) => call.command === "deno" && call.args.join(" ") === "task submodules:check:remote"),
        true,
    );
    assertEquals(
        calls.some((call) => call.command === "git" && call.args[0] === "tag" && call.args.includes("-a")),
        false,
    );
    assertEquals(calls.some((call) => call.command === "git" && call.args[0] === "push"), false);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("create")), false);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("edit")), false);
    assertEquals(calls.some((call) => call.command === "glab"), false);
});

Deno.test("createCandidate stops before side effects when preflight fails", async () => {
    const { deps, calls } = depsForCommands({
        "git branch --show-current": { stdout: "feature\n" },
    });

    await assertRejects(() => createCandidate(deps, "v1.2.3-rc.1", true), Error, "main");

    assertEquals(calls.some((call) => call.args.includes("tag") || call.args.includes("push")), false);
});

Deno.test("createCandidate rejects duplicate GitHub release before creating a tag", async () => {
    const { deps, calls } = depsForCommands({
        "git branch --show-current": { stdout: "main\n" },
        "git status --porcelain": { stdout: "" },
        "git rev-parse HEAD": { stdout: "abc123\n" },
        "git rev-parse @{u}": { stdout: "abc123\n" },
        "git tag --list v*": { stdout: "v1.2.2\n" },
        "git ls-remote --tags origin refs/tags/v*": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1": { stdout: "" },
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "gh release view v1.2.3-rc.1 --json id": { stdout: JSON.stringify({ id: "existing" }) },
    });

    await assertRejects(() => createCandidate(deps, "v1.2.3-rc.1", false), Error, "GitHub release already exists");

    assertEquals(
        calls.some((call) => call.command === "git" && call.args[0] === "tag" && call.args.includes("-a")),
        false,
    );
    assertEquals(calls.some((call) => call.command === "git" && call.args[0] === "push"), false);
});

Deno.test("createCandidate accepts explicit minor and major Candidate selections newer than previous Stable", async () => {
    for (const candidate of ["v1.3.0-rc.1", "v2.0.0-rc.1"]) {
        const { deps } = depsForCommands({
            "git branch --show-current": { stdout: "main\n" },
            "git status --porcelain": { stdout: "" },
            "git rev-parse HEAD": { stdout: "abc123\n" },
            "git rev-parse @{u}": { stdout: "abc123\n" },
            "git tag --list v*": { stdout: "v1.2.3\n" },
            "git ls-remote --tags origin refs/tags/v*": { stdout: "" },
            "deno task submodules:check:remote": { stdout: "ok\n" },
            [`git rev-parse ${candidate}^{commit}`]: { success: false, code: 1 },
            [`git ls-remote --tags origin refs/tags/${candidate}`]: { stdout: "" },
            [`git rev-parse ${stableTagForCandidate(candidate)}^{commit}`]: { success: false, code: 1 },
            [`git ls-remote --tags origin refs/tags/${stableTagForCandidate(candidate)}`]: { stdout: "" },
        });

        await createCandidate(deps, candidate, true);
    }
});

Deno.test("createCandidate enforces next RC ordinal from real local and remote tags", async () => {
    const fixture = await createReleaseRepo();
    try {
        await runCommand("git", ["tag", "-a", "v1.2.2", "-m", "stable"], { cwd: fixture.repo });
        await runCommand("git", ["tag", "-a", "v1.2.3-rc.1", "-m", "candidate"], { cwd: fixture.repo });
        await runCommand("git", ["push", "origin", "refs/tags/v1.2.2", "refs/tags/v1.2.3-rc.1"], { cwd: fixture.repo });
        const { deps } = repoDeps(fixture.repo);
        await assertRejects(() => createCandidate(deps, "v1.2.3-rc.3", true), Error, "v1.2.3-rc.2");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("createStable rejects regressive tags and dirty or diverged real checkouts", async () => {
    const fixture = await createReleaseRepo();
    try {
        await runCommand("git", ["tag", "-a", "v1.2.2", "-m", "stable"], { cwd: fixture.repo });
        await runCommand("git", ["push", "origin", "refs/tags/v1.2.2"], { cwd: fixture.repo });
        const { deps } = repoDeps(fixture.repo);
        await assertRejects(() => createStable(deps, "v1.2.1", true), Error, "newer than previous Stable");
        await Deno.writeTextFile(`${fixture.repo}/dirty.txt`, "dirty\n");
        await assertRejects(() => createStable(deps, "v1.2.3", true), Error, "clean");
        await Deno.remove(`${fixture.repo}/dirty.txt`);
        await Deno.writeTextFile(`${fixture.repo}/file.txt`, "ahead\n");
        await runCommand("git", ["commit", "-am", "ahead"], { cwd: fixture.repo });
        await assertRejects(() => createStable(deps, "v1.2.3", true), Error, "upstream");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("createStable refuses direct Stable when a Candidate exists for that version", async () => {
    const fixture = await createReleaseRepo();
    try {
        await runCommand("git", ["tag", "-a", "v1.2.2", "-m", "stable"], { cwd: fixture.repo });
        await runCommand("git", ["tag", "-a", "v1.2.3-rc.1", "-m", "candidate"], { cwd: fixture.repo });
        await runCommand("git", ["push", "origin", "refs/tags/v1.2.2", "refs/tags/v1.2.3-rc.1"], { cwd: fixture.repo });
        const { deps } = repoDeps(fixture.repo);
        await assertRejects(() => createStable(deps, "v1.2.3", true), Error, "release:promote");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("promoteCandidate tags the Candidate peeled commit instead of HEAD in a real repository", async () => {
    const fixture = await createReleaseRepo();
    try {
        await runCommand("git", ["tag", "-a", "v1.2.2", "-m", "stable"], { cwd: fixture.repo });
        await Deno.writeTextFile(`${fixture.repo}/file.txt`, "candidate\n");
        await runCommand("git", ["commit", "-am", "candidate"], { cwd: fixture.repo });
        const candidateCommit = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: fixture.repo })).trim();
        await runCommand("git", ["tag", "-a", "v1.2.3-rc.1", "-m", "candidate"], { cwd: fixture.repo });
        await runCommand("git", ["push", "origin", "main", "refs/tags/v1.2.2", "refs/tags/v1.2.3-rc.1"], {
            cwd: fixture.repo,
        });
        await Deno.writeTextFile(`${fixture.repo}/file.txt`, "after candidate\n");
        await runCommand("git", ["commit", "-am", "after candidate"], { cwd: fixture.repo });
        const headCommit = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: fixture.repo })).trim();
        const { deps } = repoDeps(fixture.repo);
        await promoteCandidate(deps, "v1.2.3-rc.1", false);
        const stableCommit = (await runCommand("git", ["rev-parse", "v1.2.3^{commit}"], { cwd: fixture.repo })).trim();
        assertEquals(stableCommit, candidateCommit);
        assertEquals(stableCommit === headCommit, false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("promoteCandidate rejects version regressions before tag or push", async () => {
    const { deps, calls } = depsForCommands({
        "git tag --list v*": { stdout: "v1.2.3\n" },
        "git ls-remote --tags origin refs/tags/v*": { stdout: "stable-object\trefs/tags/v1.2.3\n" },
        "git rev-parse v1.2.2^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.2": { stdout: "" },
        "git rev-parse v1.2.2-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "git ls-remote --tags origin refs/tags/v1.2.2-rc.1*": {
            stdout: "tag-object\trefs/tags/v1.2.2-rc.1\ncandidate-sha\trefs/tags/v1.2.2-rc.1^{}\n",
        },
    });

    await assertRejects(() => promoteCandidate(deps, "v1.2.2-rc.1", false), Error, "newer than previous Stable");

    assertEquals(calls.some((call) => call.command === "gh"), false);
    assertEquals(
        calls.some((call) => call.command === "git" && call.args[0] === "tag" && call.args.includes("-a")),
        false,
    );
    assertEquals(calls.some((call) => call.command === "git" && call.args[0] === "push"), false);
});

Deno.test("promoteCandidate rejects stale local Candidate tags instead of promoting local-only source", async () => {
    const assets = expectedReleaseAssetNames("v1.2.3-rc.1").map((name) => ({ name }));
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "local-sha\n" },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1*": {
            stdout: "tag-object\trefs/tags/v1.2.3-rc.1\nremote-sha\trefs/tags/v1.2.3-rc.1^{}\n",
        },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
        },
    });

    await assertRejects(() => promoteCandidate(deps, "v1.2.3-rc.1", false), Error, "stale local tag");

    assertEquals(
        calls.some((call) => call.command === "git" && call.args[0] === "tag" && call.args.includes("-a")),
        false,
    );
    assertEquals(calls.some((call) => call.command === "git" && call.args[0] === "push"), false);
});

Deno.test("promoteCandidate records only Candidate tag provenance and never edits host releases", async () => {
    const assets = expectedReleaseAssetNames("v1.2.3-rc.1").map((name) => ({ name }));
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1*": {
            stdout: "tag-object\trefs/tags/v1.2.3-rc.1\ncandidate-sha\trefs/tags/v1.2.3-rc.1^{}\n",
        },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
        },
    });

    await promoteCandidate(deps, "v1.2.3-rc.1", true);

    const tagCall = calls.find((call) => call.args[0] === "tag" && call.args.includes("-a"));
    assertEquals(tagCall, undefined);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("edit")), false);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("create")), false);
});

Deno.test("promoteCandidate rejects incomplete Candidate assets before tag creation", async () => {
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1*": {
            stdout: "tag-object\trefs/tags/v1.2.3-rc.1\ncandidate-sha\trefs/tags/v1.2.3-rc.1^{}\n",
        },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets: [{ name: "SHA256SUMS" }] }),
        },
    });

    await assertRejects(() => promoteCandidate(deps, "v1.2.3-rc.1", true), Error, "missing asset");
    assertEquals(
        calls.some((call) => (call.args[0] === "tag" && call.args.includes("-a")) || call.args[0] === "push"),
        false,
    );
});

Deno.test("non-dry-run promotion annotation contains Candidate tag without a source SHA field", async () => {
    const assets = expectedReleaseAssetNames("v1.2.3-rc.1").map((name) => ({ name }));
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1*": {
            stdout: "tag-object\trefs/tags/v1.2.3-rc.1\ncandidate-sha\trefs/tags/v1.2.3-rc.1^{}\n",
        },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
        },
    });
    deps.makeTempDir = () => Promise.resolve("/tmp/wld-promote-test");
    deps.remove = () => Promise.resolve();

    await promoteCandidate(deps, "v1.2.3-rc.1", false);

    const tagCall = calls.find((call) => call.command === "git" && call.args[0] === "tag" && call.args.includes("-a"));
    assertStringIncludes(tagCall?.args.join("\n") || "", "Promoted-From: v1.2.3-rc.1");
    assertEquals((tagCall?.args.join("\n") || "").includes("candidate-sha"), true, "tag target may be the commit");
    assertEquals(
        (tagCall?.args.at(-1) || "").includes("candidate-sha"),
        false,
        "annotation must not persist source SHA",
    );
});
