// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertStringIncludes } from "@std/assert";

Deno.test("local and owner Plan Board routes share one page composition", async () => {
    const local = await Deno.readTextFile(new URL("./pages/index.astro", import.meta.url));
    const owner = await Deno.readTextFile(new URL("./components/ProjectPlanBoardPage.astro", import.meta.url));
    const shared = await Deno.readTextFile(new URL("./components/PlanBoardPage.astro", import.meta.url));

    assertStringIncludes(local, "PlanBoardPage");
    assertStringIncludes(local, 'context="local"');
    assertStringIncludes(owner, "PlanBoardPage");
    assertStringIncludes(owner, 'context="workspace"');
    assertStringIncludes(shared, "PlanBoardToolbar");
    assertStringIncludes(shared, "<PlanBoard");
    assertStringIncludes(shared, 'shell={context === "workspace" ? "workspace" : "local"}');
});

Deno.test("dev Surface Lab exposes both presentations of every shared surface", async () => {
    const catalog = await Deno.readTextFile(new URL("./pages/dev/index.astro", import.meta.url));

    for (
        const path of [
            "/projects/dev-project/plans",
            "/dev/plan-review",
            "/dev/workspace/plan-review",
            "/dev/code-review",
            "/dev/workspace/code-review",
        ]
    ) assertStringIncludes(catalog, path);
});

Deno.test("Workspace development has one Surface Lab entry task", async () => {
    const denoConfig = JSON.parse(
        await Deno.readTextFile(new URL("../../../deno.json", import.meta.url)),
    );
    const taskNames = Object.keys(denoConfig.tasks);

    assertStringIncludes(denoConfig.tasks["workspace:dev"], "--open /dev");
    if (taskNames.some((taskName) => taskName.startsWith("workspace:dev:"))) {
        throw new Error("Use workspace:dev and add new fixtures to the Surface Lab instead of adding launch aliases");
    }
});
