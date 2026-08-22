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

Deno.test("Plan feedback action sits above the annotation list with theme accent styling", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);
    const styles = await Deno.readTextFile("src/ui/workspace/react/plannotator.css");
    const sidebarIndex = surface.indexOf('className="rw-plan-review-annotation-sidebar"');
    const actionIndex = surface.indexOf('label="Send Annotations"');
    const panelIndex = surface.indexOf('presentation="embedded"');

    assertStringIncludes(surface, 'className="rw-plan-review-feedback-action"');
    assertStringIncludes(styles, ".rw-plan-review-feedback-action");
    assertStringIncludes(styles, "var(--rw-accent)");
    if (sidebarIndex < 0 || actionIndex < sidebarIndex || panelIndex < actionIndex) {
        throw new Error("Send Annotations must sit above the right-side annotation list");
    }
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

Deno.test("revised Plan reviews expose Plannotator Changes beside View and Edit", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "usePlanDiff");
    assertStringIncludes(surface, "PlanDiffViewer");
    assertStringIncludes(surface, "Compare this revision with the initial Plan");
    assertStringIncludes(surface, ">\n                                                Changes\n");
});
