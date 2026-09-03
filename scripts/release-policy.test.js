import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

Deno.test("release prompt starts with the three release choices before policy discovery", async () => {
    const prompt = await Deno.readTextFile(new URL("../src/prompt-templates/release.md", import.meta.url));
    const choiceIndex = prompt.indexOf("What kind of release operation should I run?");
    const discoveryIndex = prompt.indexOf("Discover the repository's release policy");

    assertEquals(choiceIndex >= 0, true);
    assertEquals(discoveryIndex > choiceIndex, true);
    assertStringIncludes(prompt, "Create Candidate");
    assertStringIncludes(prompt, "Promote Candidate");
    assertStringIncludes(prompt, "Create Stable Directly");
    assertStringIncludes(prompt, "You are running inside the wld harness");
    assertStringIncludes(prompt, "Follow repository-specific policy first");
    assertMatch(prompt, /If no repository-specific release-note scope is\s+documented/);
    assertStringIncludes(prompt, "RunWield fallback format");
    assertStringIncludes(prompt, "make notes cumulative from the previous Stable");
    assertStringIncludes(prompt, "validation-relevant changes since the prior Candidate");
    assertStringIncludes(prompt, "shared Candidate source commit");
    assertStringIncludes(prompt, "empty release");
    assertStringIncludes(prompt, "When the repository policy says CI creates the host release");
    assertEquals(prompt.includes("tools:"), false);
});

Deno.test("wld release policy distinguishes repository-specific policy from generic wld usage", async () => {
    const policy = await Deno.readTextFile(new URL("../docs/releasing.md", import.meta.url));

    assertStringIncludes(policy, "This document is wld's release policy");
    assertStringIncludes(policy, "wld users releasing other repositories");
    assertMatch(policy, /repository's\s+release policy and automation/);
    assertStringIncludes(policy, "The Candidate tag is the canonical source reference");
    assertStringIncludes(policy, "Do not store a duplicate source commit hash");
    assertStringIncludes(policy, "Promoted-From: <candidate-tag>");
    assertStringIncludes(
        policy,
        "must not call `gh release create`, `gh release edit`, `glab release create`, or `glab release edit`",
    );
    assertStringIncludes(policy, "bash install.sh vX.Y.Z-rc.N");
    assertStringIncludes(policy, "gh auth status");
    assertStringIncludes(policy, "permission to read releases before tagging");
});

Deno.test("release workflow keeps tag publication and manual recovery channel-safe", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");

    assertStringIncludes(workflow, "workflow_dispatch:");
    assertMatch(workflow, /workflow_dispatch:[\s\S]*tag:[\s\S]*required: true/);
    assertStringIncludes(workflow, "RELEASE_TAG: ${{ inputs.tag || github.ref_name }}");
    assertStringIncludes(workflow, "ref: ${{ inputs.tag || github.ref }}");
    assertMatch(workflow, /release-check:[\s\S]*ref: \$\{\{ needs\.metadata\.outputs\.tag \}\}/);
    assertMatch(workflow, /build:[\s\S]*ref: \$\{\{ needs\.metadata\.outputs\.tag \}\}/);
    assertMatch(workflow, /release:[\s\S]*ref: \$\{\{ needs\.metadata\.outputs\.tag \}\}/);
    assertStringIncludes(workflow, "deno task release:metadata --tag");
    assertStringIncludes(workflow, "WLD_BUILD_VERSION");
    assertStringIncludes(workflow, "prerelease: ${{ needs.metadata.outputs.prerelease }}");
    assertStringIncludes(workflow, "make_latest: ${{ needs.metadata.outputs.make_latest }}");
    assertStringIncludes(workflow, "config.schema.json");
    assertStringIncludes(workflow, "release-artifacts/**/*.sha256");
    assertStringIncludes(workflow, "release-artifacts/SHA256SUMS");
    assertStringIncludes(workflow, "wld-${VERSION}-${{ matrix.asset_suffix }}");

    const policy = await Deno.readTextFile("docs/releasing.md");
    assertStringIncludes(policy, "required-tag manual dispatch solely for recovery");
    assertMatch(policy, /Never use manual recovery to bypass a genuine failure in tagged product\s+source/);
});

Deno.test("release-tier Golden TUI alias does not run TODO goldens", async () => {
    const config = JSON.parse(await Deno.readTextFile("deno.json"));
    const normalTest = String(config.tasks?.test || "");
    const extensiveGoldenTest = String(config.tasks?.["test:golden-tui:extensive"] || "");

    assertEquals(normalTest.includes("RUNWIELD_RUN_TODO_GOLDENS"), false);
    assertEquals(extensiveGoldenTest.includes("RUNWIELD_RUN_TODO_GOLDENS"), false);
    assertStringIncludes(extensiveGoldenTest, "src/ui/tui/golden-scenarios");
});

Deno.test("release qualification owns the only Golden TUI run in the release workflow", async () => {
    const releaseCheck = await Deno.readTextFile(new URL("./release-check.js", import.meta.url));
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");

    assertStringIncludes(releaseCheck, '["task", "test:golden-tui:extensive"]');
    assertStringIncludes(workflow, "deno task release:check --build-version");
    assertEquals(workflow.includes("deno task test:golden-tui"), false);
});

Deno.test("release CLI publishes tags without owning qualification or host release mutation", async () => {
    const script = await Deno.readTextFile(new URL("./release.js", import.meta.url));

    assertEquals(script.includes("release create"), false);
    assertEquals(script.includes("release edit"), false);
    assertStringIncludes(script, '"gh", [');
    assertStringIncludes(script, '"release",');
    assertStringIncludes(script, '"view",');
    assertEquals(script.includes('"release:check"'), false);
    assertEquals(script.includes('"submodules:check:remote"'), false);
    assertEquals(script.includes('"branch", "--show-current"'), false);
    assertEquals(script.includes('"status", "--porcelain"'), false);
});

Deno.test("README links to wld release policy", async () => {
    const readme = await Deno.readTextFile(new URL("../README.md", import.meta.url));
    assertStringIncludes(readme, "[releasing](docs/releasing.md)");
});
