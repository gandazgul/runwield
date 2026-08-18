// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertStringIncludes } from "@std/assert";

const ROUTE_PATH = "src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro";
const SURFACE_PATH = "src/ui/workspace/react/PlanReviewSurface.tsx";

Deno.test("Phone Plan review keeps full editing annotations and actions reachable", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "Edit");
    assertStringIncludes(surface, "Annotations");
    assertStringIncludes(surface, "Feedback");
});

Deno.test("Feedback and Run return to Session while Later stays on confirmation", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(route, "interactionAnswerUrl");
    assertStringIncludes(surface, "Approve & Run");
    assertStringIncludes(surface, "Later");
    assertStringIncludes(surface, "approved-later");
});

Deno.test("Plan and Epic reviews expose classification-correct actions", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "PLAN_APPROVAL_ACTIONS.DECOMPOSE");
    assertStringIncludes(surface, "Approve & Slice");
    assertStringIncludes(surface, "Approve & Run");
});
