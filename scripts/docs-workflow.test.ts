import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Stable release publication calls docs with the selected tag after release succeeds", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/release.yml");
    const job = workflow.slice(workflow.indexOf("    publish-docs:"));
    assertStringIncludes(job, "!cancelled()");
    assertStringIncludes(job, "needs.metadata.outputs.kind == 'stable'");
    assertStringIncludes(job, "needs.release.result == 'success'");
    assertStringIncludes(job, "uses: ./.github/workflows/docs.yml");
    assertStringIncludes(job, "tag: ${{ needs.metadata.outputs.tag }}");
    assertEquals(job.includes("github.sha"), false);
});

Deno.test("docs workflow rejects stale releases and product changes before deployment", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/docs.yml");
    const reconciliation = await Deno.readTextFile("scripts/reconcile-docs-branch.sh");
    assertStringIncludes(
        workflow,
        "github.event_name != 'push' || github.ref != 'refs/heads/docs/stable'",
    );
    assertStringIncludes(workflow, "uses: denoland/setup-deno@v2");
    const deploy = workflow.slice(workflow.indexOf("    deploy:"));
    assertEquals(
        deploy.indexOf("uses: denoland/setup-deno@v2") < deploy.indexOf("documented=$(deno eval"),
        true,
    );
    assertStringIncludes(workflow, 'test "$tag" = "$latest"');
    assertStringIncludes(
        workflow,
        'git merge-base --is-ancestor "$documented" HEAD',
    );
    assertStringIncludes(workflow, "Docs branch changes product path");
    assertStringIncludes(reconciliation, "git push origin HEAD:docs/stable");
    assertEquals(reconciliation.includes("--force"), false);
    assertStringIncludes(workflow, "group: runwield-docs-pages");
    assertStringIncludes(workflow, "cancel-in-progress: false");
    assertStringIncludes(workflow, "sha=$(git rev-parse HEAD)");
    assertStringIncludes(
        workflow,
        "ref: ${{ needs.sync.outputs.sha || github.sha }}",
    );
});

Deno.test("docs recovery can run after intentionally skipped upstream work", async () => {
    const release = await Deno.readTextFile(".github/workflows/release.yml");
    const job = release.slice(release.indexOf("    publish-docs:"));
    assertStringIncludes(job, "if: ${{ !cancelled()");
    assertStringIncludes(job, "needs.release.result == 'success'");
});
