import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

Deno.test("release prompt starts with the three generic release choices before WLD policy discovery", async () => {
    const prompt = await Deno.readTextFile("src/prompt-templates/release.md");
    const choiceIndex = prompt.indexOf("What kind of release operation should I run?");
    const discoveryIndex = prompt.indexOf("Discover the repository's release policy");

    assertEquals(choiceIndex >= 0, true);
    assertEquals(discoveryIndex > choiceIndex, true);
    assertStringIncludes(prompt, "Create Candidate");
    assertStringIncludes(prompt, "Promote Candidate");
    assertStringIncludes(prompt, "Create Stable Directly");
    assertStringIncludes(prompt, "This prompt is generic");
    assertStringIncludes(prompt, "If this repository is not WLD");
    assertEquals(prompt.includes("tools:"), false);
});

Deno.test("WLD release policy distinguishes repository-specific policy from generic WLD usage", async () => {
    const policy = await Deno.readTextFile("RELEASING.md");

    assertStringIncludes(policy, "This document is WLD's release policy");
    assertStringIncludes(policy, "WLD users releasing other repositories");
    assertMatch(policy, /repository's\s+release policy and automation/);
    assertStringIncludes(policy, "The Candidate tag is the canonical source reference");
    assertStringIncludes(policy, "Do not store a duplicate source commit hash");
    assertStringIncludes(policy, "Promoted-From: <candidate-tag>");
    assertStringIncludes(
        policy,
        "must not call `gh release create`, `gh release edit`, `glab release create`, or `glab release edit`",
    );
    assertStringIncludes(policy, "bash install.sh vX.Y.Z-rc.N");
});

Deno.test("release workflow is tag-only and channel-safe", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");

    assertEquals(workflow.includes("workflow_dispatch"), false);
    assertStringIncludes(workflow, "deno task release:metadata --tag");
    assertStringIncludes(workflow, "WLD_BUILD_VERSION");
    assertStringIncludes(workflow, "prerelease: ${{ needs.metadata.outputs.prerelease }}");
    assertStringIncludes(workflow, "make_latest: ${{ needs.metadata.outputs.make_latest }}");
    assertStringIncludes(workflow, "config.schema.json");
    assertStringIncludes(workflow, "release-artifacts/SHA256SUMS");
    assertStringIncludes(workflow, "wld-${VERSION}-${{ matrix.asset_suffix }}");
});

Deno.test("release CLI does not own host release creation or notes editing", async () => {
    const script = await Deno.readTextFile("scripts/release.js");

    assertEquals(script.includes("release create"), false);
    assertEquals(script.includes("release edit"), false);
    assertStringIncludes(script, '"gh", [');
    assertStringIncludes(script, '"release",');
    assertStringIncludes(script, '"view",');
});

Deno.test("README links to WLD release policy", async () => {
    const readme = await Deno.readTextFile("README.md");
    assertStringIncludes(readme, "[RELEASING.md](RELEASING.md)");
});
