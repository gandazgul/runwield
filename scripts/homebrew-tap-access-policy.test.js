import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Homebrew credential check proves write access without changing the tap default branch", async () => {
    const workflow = await Deno.readTextFile(".github/workflows/homebrew-tap-access.yml");
    const createIndex = workflow.indexOf('git push origin "HEAD:refs/heads/$CHECK_BRANCH"');
    const deleteIndex = workflow.indexOf('git push origin --delete "$CHECK_BRANCH"', createIndex);

    assertStringIncludes(workflow, "workflow_dispatch:");
    assertStringIncludes(workflow, "repository: gandazgul/homebrew-tap");
    assertStringIncludes(workflow, "token: ${{ secrets.HOMEBREW_TAP_TOKEN }}");
    assertStringIncludes(workflow, "CHECK_BRANCH: credential-check-${{ github.run_id }}-${{ github.run_attempt }}");
    assertEquals(createIndex >= 0, true);
    assertEquals(deleteIndex > createIndex, true);
    assertEquals(workflow.includes("HEAD:main"), false);
});
