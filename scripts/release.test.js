import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";

import {
    createCandidate,
    expectedReleaseAssetNames,
    nextCandidateTag,
    parseReleaseArgs,
    parseReleaseTag,
    previousStableTag,
    promoteCandidate,
    releaseMetadataForTag,
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
    for (const tag of ["1.2.3", "v1.2.3-beta.1", "v1.2.3-rc.0", "v1.2.3/bad", "v1.2.3\n"]) {
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
            const response = responses[key] || { success: true, code: 0, stdout: "", stderr: "" };
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

Deno.test("createCandidate dry-run preflights and avoids tag, push, and host release commands", async () => {
    const { deps, calls } = depsForCommands({
        "git branch --show-current": { stdout: "main\n" },
        "git status --porcelain": { stdout: "" },
        "git rev-parse HEAD": { stdout: "abc123\n" },
        "git rev-parse @{u}": { stdout: "abc123\n" },
        "git rev-parse v1.2.3-rc.1^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3-rc.1": { stdout: "" },
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
    });

    await createCandidate(deps, "v1.2.3-rc.1", true);

    assertEquals(calls.some((call) => call.args.includes("tag")), false);
    assertEquals(calls.some((call) => call.command === "gh" || call.command === "glab"), false);
});

Deno.test("createCandidate stops before side effects when preflight fails", async () => {
    const { deps, calls } = depsForCommands({
        "git branch --show-current": { stdout: "feature\n" },
    });

    await assertRejects(() => createCandidate(deps, "v1.2.3-rc.1", true), Error, "main");

    assertEquals(calls.some((call) => call.args.includes("tag") || call.args.includes("push")), false);
});

Deno.test("promoteCandidate records only Candidate tag provenance and never edits host releases", async () => {
    const assets = expectedReleaseAssetNames("v1.2.3-rc.1").map((name) => ({ name }));
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
        },
    });

    await promoteCandidate(deps, "v1.2.3-rc.1", true);

    const tagCall = calls.find((call) => call.args[0] === "tag");
    assertEquals(tagCall, undefined);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("edit")), false);
    assertEquals(calls.some((call) => call.command === "gh" && call.args.includes("create")), false);
});

Deno.test("promoteCandidate rejects incomplete Candidate assets before tag creation", async () => {
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets: [{ name: "SHA256SUMS" }] }),
        },
    });

    await assertRejects(() => promoteCandidate(deps, "v1.2.3-rc.1", true), Error, "missing asset");
    assertEquals(calls.some((call) => call.args[0] === "tag" || call.args[0] === "push"), false);
});

Deno.test("non-dry-run promotion annotation contains Candidate tag without a source SHA field", async () => {
    const assets = expectedReleaseAssetNames("v1.2.3-rc.1").map((name) => ({ name }));
    const { deps, calls } = depsForCommands({
        "git rev-parse v1.2.3^{commit}": { success: false, code: 1 },
        "git ls-remote --tags origin refs/tags/v1.2.3": { stdout: "" },
        "git rev-parse v1.2.3-rc.1^{commit}": { stdout: "candidate-sha\n" },
        "gh release view v1.2.3-rc.1 --json isPrerelease,isDraft,assets": {
            stdout: JSON.stringify({ isPrerelease: true, isDraft: false, assets }),
        },
    });
    deps.makeTempDir = () => Promise.resolve("/tmp/wld-promote-test");
    deps.remove = () => Promise.resolve();

    await promoteCandidate(deps, "v1.2.3-rc.1", false);

    const tagCall = calls.find((call) => call.command === "git" && call.args[0] === "tag");
    assertStringIncludes(tagCall?.args.join("\n") || "", "Promoted-From: v1.2.3-rc.1");
    assertEquals((tagCall?.args.join("\n") || "").includes("candidate-sha"), true, "tag target may be the commit");
    assertEquals(
        (tagCall?.args.at(-1) || "").includes("candidate-sha"),
        false,
        "annotation must not persist source SHA",
    );
});
