import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

interface ReleaseState {
    cancelled: boolean;
    kind: string;
    published: string;
    ciResult: string;
    goldenResult: string;
    releaseCheckResult: string;
    buildResult: string;
    assetsResult: string;
    windowsResult: string;
    homebrewResult: string;
    releaseResult: string;
}

function jobBlock(workflow: string, name: string): string {
    const start = workflow.indexOf(`    ${name}:`);
    if (start < 0) throw new Error(`Missing job ${name}`);
    const remainder = workflow.slice(start + 1);
    const nextJob = remainder.match(/^ {4}[a-z][\w-]*:\s*$/m);
    const end = nextJob?.index === undefined ? undefined : start + 1 + nextJob.index;
    return workflow.slice(start, end);
}

function jobCondition(job: string): string {
    const match = job.match(/\n\s+if:\s*(?:\$\{\{\s*)?(.*?)(?:\s*\}\})?\s*$/m);
    if (!match) throw new Error("Job has no condition");
    return match[1];
}

function stepRun(job: string, name: string): string {
    const marker = `            - name: ${name}\n`;
    const start = job.indexOf(marker);
    if (start < 0) throw new Error(`Missing step ${name}`);
    const block = job.slice(start + marker.length);
    const next = block.search(/^ {12}- name:/m);
    const step = next < 0 ? block : block.slice(0, next);
    const run = step.match(/^ {14}run:\s*\|\n([\s\S]*)$/m);
    if (!run) throw new Error(`Step ${name} has no multiline command`);
    return run[1].split("\n").map((line) => line.slice(18)).join("\n").trim();
}

function evaluateReleaseCondition(condition: string, state: ReleaseState): boolean {
    const values: Record<string, string | boolean> = {
        "!cancelled()": !state.cancelled,
        "needs.metadata.outputs.kind": state.kind,
        "needs.metadata.outputs.published": state.published,
        "needs.ci.result": state.ciResult,
        "needs.golden.result": state.goldenResult,
        "needs.release-check.result": state.releaseCheckResult,
        "needs.build.result": state.buildResult,
        "needs.assets.result": state.assetsResult,
        "needs.windows-package-check.result": state.windowsResult,
        "needs.homebrew-check.result": state.homebrewResult,
        "needs.release.result": state.releaseResult,
    };
    let expression = condition;
    for (const [key, value] of Object.entries(values)) {
        expression = expression.replaceAll(key, JSON.stringify(value));
    }
    return Boolean(Function(`"use strict"; return (${expression});`)());
}

async function executable(path: string, content: string): Promise<void> {
    await Deno.writeTextFile(path, content);
    await Deno.chmod(path, 0o755);
}

async function runShell(
    command: string,
    env: Record<string, string>,
): Promise<Deno.CommandOutput> {
    return await new Deno.Command("bash", {
        args: ["-c", command],
        cwd: Deno.cwd(),
        env,
        clearEnv: false,
        stdout: "piped",
        stderr: "piped",
    }).output();
}

const successfulRelease: ReleaseState = {
    cancelled: false,
    kind: "stable",
    published: "false",
    ciResult: "success",
    goldenResult: "success",
    releaseCheckResult: "success",
    buildResult: "success",
    assetsResult: "success",
    windowsResult: "success",
    homebrewResult: "success",
    releaseResult: "success",
};

Deno.test("actual release event condition publishes only qualified Stable results", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");
    const job = jobBlock(workflow, "publish-docs");
    const condition = jobCondition(job);
    assertEquals(evaluateReleaseCondition(condition, successfulRelease), true);
    assertEquals(evaluateReleaseCondition(condition, { ...successfulRelease, kind: "candidate" }), false);
    assertEquals(evaluateReleaseCondition(condition, { ...successfulRelease, releaseResult: "failure" }), false);
    assertEquals(evaluateReleaseCondition(condition, { ...successfulRelease, cancelled: true }), false);
    assertStringIncludes(job, "uses: ./.github/workflows/docs.yml");
    assertStringIncludes(job, "tag: ${{ needs.metadata.outputs.tag }}");
    assertEquals(job.includes("github.sha"), false);
});

Deno.test("fresh and existing releases traverse the actual qualification conditions", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");
    const build = jobBlock(workflow, "build");
    const assets = jobBlock(workflow, "assets");
    const release = jobBlock(workflow, "release");
    const publish = jobBlock(workflow, "publish-docs");

    assertEquals(evaluateReleaseCondition(jobCondition(build), successfulRelease), true);
    assertEquals(evaluateReleaseCondition(jobCondition(assets), successfulRelease), true);
    assertEquals(evaluateReleaseCondition(jobCondition(release), successfulRelease), true);
    assertEquals(evaluateReleaseCondition(jobCondition(publish), successfulRelease), true);

    const recovery = { ...successfulRelease, published: "true", buildResult: "skipped" };
    assertEquals(evaluateReleaseCondition(jobCondition(build), recovery), false);
    assertEquals(evaluateReleaseCondition(jobCondition(assets), recovery), true);
    assertEquals(evaluateReleaseCondition(jobCondition(release), recovery), true);
    assertEquals(evaluateReleaseCondition(jobCondition(publish), recovery), true);
    assertStringIncludes(jobBlock(workflow, "release-check"), "needs: metadata");
    assertStringIncludes(jobBlock(workflow, "golden-shards"), "needs: metadata");
    for (const gate of ["ci", "golden"]) {
        const aggregate = jobBlock(workflow, gate);
        assertStringIncludes(aggregate, `needs: ${gate}-shards`);
        assertStringIncludes(aggregate, "if: always()");
        assertStringIncludes(aggregate, "test '${{ needs." + gate + "-shards.result }}' = 'success'");
    }
    assertStringIncludes(release, "needs.ci.result == 'success'");
    assertStringIncludes(release, "needs.golden.result == 'success'");
    assertStringIncludes(release, "needs.release-check.result == 'success'");
    assertStringIncludes(release, "needs.assets.result == 'success'");
    for (
        const key of [
            "ciResult",
            "goldenResult",
            "releaseCheckResult",
            "assetsResult",
            "windowsResult",
            "homebrewResult",
        ]
    ) {
        for (const status of ["failure", "cancelled", "skipped"]) {
            assertEquals(
                evaluateReleaseCondition(jobCondition(release), { ...successfulRelease, [key]: status }),
                false,
            );
            assertEquals(evaluateReleaseCondition(jobCondition(release), { ...recovery, [key]: status }), false);
        }
    }
    assertEquals(
        evaluateReleaseCondition(jobCondition(assets), { ...successfulRelease, buildResult: "failure" }),
        false,
    );
    assertEquals(evaluateReleaseCondition(jobCondition(release), { ...successfulRelease, cancelled: true }), false);
});

Deno.test("production release selection stops on API errors and old release retries", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/docs.yml");
    const command = stepRun(jobBlock(workflow, "sync"), "Select latest Stable release");
    const root = await Deno.makeTempDir();
    try {
        const bin = join(root, "bin");
        await Deno.mkdir(bin);
        await executable(
            join(bin, "gh"),
            `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${GH_MODE:-}" == api-error ]]; then echo "API unavailable" >&2; exit 41; fi
if [[ "$1 $2" == "release view" && "$*" == *"tagName"* ]]; then echo "\${LATEST_TAG}"; else echo '{}'; fi
`,
        );
        await executable(join(bin, "git"), "#!/usr/bin/env bash\nexit 0\n");
        const output = join(root, "output");
        const base = {
            PATH: `${bin}:${Deno.env.get("PATH") ?? ""}`,
            GITHUB_OUTPUT: output,
            GITHUB_REPOSITORY: "owner/repository",
            LATEST_TAG: "v2.0.0",
        };
        const apiFailure = await runShell(command, { ...base, GH_MODE: "api-error", REQUESTED_TAG: "" });
        assertEquals(apiFailure.success, false);
        assertStringIncludes(new TextDecoder().decode(apiFailure.stderr), "API unavailable");

        const oldRetry = await runShell(command, { ...base, GH_MODE: "ok", REQUESTED_TAG: "v1.0.0" });
        assertEquals(oldRetry.success, false);
        assertStringIncludes(new TextDecoder().decode(oldRetry.stderr), "Refusing to replace current docs");

        const retry = await runShell(command, { ...base, GH_MODE: "ok", REQUESTED_TAG: "v2.0.0" });
        assert(retry.success, new TextDecoder().decode(retry.stderr));
        assertStringIncludes(await Deno.readTextFile(output), "tag=v2.0.0");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("production asset qualification rejects API errors and incomplete releases", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/docs.yml");
    const command = stepRun(jobBlock(workflow, "sync"), "Verify complete qualified release assets");
    const root = await Deno.makeTempDir();
    try {
        const bin = join(root, "bin");
        await Deno.mkdir(bin);
        await executable(
            join(bin, "gh"),
            `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${GH_MODE:-}" == api-error ]]; then echo "API unavailable" >&2; exit 42; fi
if [[ "$1 $2" == "release download" ]]; then
  while [[ $# -gt 0 ]]; do if [[ "$1" == --dir ]]; then mkdir -p "$2"; echo partial > "$2/partial"; exit 0; fi; shift; done
fi
if [[ "$1" == api ]]; then echo '{"assets":[]}'; exit 0; fi
exit 1
`,
        );
        const base = {
            PATH: `${bin}:${Deno.env.get("PATH") ?? ""}`,
            GITHUB_REPOSITORY: "owner/repository",
            RELEASE_TAG: "v2.0.0",
            RUNNER_TEMP: root,
        };
        const apiFailure = await runShell(command, { ...base, GH_MODE: "api-error" });
        assertEquals(apiFailure.success, false);
        assertStringIncludes(new TextDecoder().decode(apiFailure.stderr), "API unavailable");

        const incomplete = await runShell(command, { ...base, GH_MODE: "incomplete" });
        assertEquals(incomplete.success, false);
        assertStringIncludes(new TextDecoder().decode(incomplete.stderr), "Expected one");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("docs workflow validates release assets and exact source before deployment", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/docs.yml");
    const reconciliation = await Deno.readTextFile("scripts/reconcile-docs-branch.sh");
    const deploy = jobBlock(workflow, "deploy");
    assertStringIncludes(workflow, "github.event_name != 'push' || github.ref != 'refs/heads/docs/stable'");
    assertStringIncludes(workflow, 'test "$tag" = "$latest"');
    assertEquals((workflow.match(/scripts\/release-assets\.js/g) ?? []).length, 2);
    assertEquals((deploy.match(/scripts\/verify-docs-source\.ts/g) ?? []).length, 2);
    assertEquals(
        deploy.lastIndexOf("scripts/verify-docs-source.ts") < deploy.indexOf("uses: actions/deploy-pages@v4"),
        true,
    );
    assertStringIncludes(workflow, "isPrerelease == false and .isDraft == false");
    assertStringIncludes(reconciliation, "git push origin HEAD:docs/stable");
    assertEquals(reconciliation.includes("--force"), false);
    assertStringIncludes(workflow, "group: runwield-docs-pages");
    assertStringIncludes(workflow, "cancel-in-progress: false");
    assertStringIncludes(workflow, "sha=$(git rev-parse HEAD)");
    assertStringIncludes(workflow, "ref: ${{ needs.sync.outputs.sha || github.sha }}");
});
