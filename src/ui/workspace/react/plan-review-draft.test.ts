import { assertEquals, assertStringIncludes } from "@std/assert";
import { type Annotation, AnnotationType } from "@plannotator/ui/types.ts";
import {
    createPlanReviewDraft,
    parsePlanReviewDraft,
    planReviewDraftDescription,
    planReviewDraftKey,
    serializePlanReviewDraft,
} from "./plan-review-draft.ts";

const annotation: Annotation = {
    id: "annotation-1",
    blockId: "context",
    startOffset: 0,
    endOffset: 7,
    type: AnnotationType.COMMENT,
    text: "Clarify this.",
    originalText: "Context",
    createdA: 1,
};

Deno.test("Plan Review drafts round-trip annotations, attachments, and direct edits", () => {
    const draft = createPlanReviewDraft({
        basePlan: "# Initial Plan\n",
        annotations: [annotation],
        globalAttachments: [{ path: "/tmp/reference.png", name: "reference" }],
        editedPlan: "# Edited Plan\n",
    });

    const restored = parsePlanReviewDraft(serializePlanReviewDraft(draft), "# Initial Plan\n");

    assertEquals(restored, draft);
    assertEquals(planReviewDraftKey("review-token"), "runwield:plan-review:review-token:draft");
    assertStringIncludes(planReviewDraftDescription(draft), "1 annotation");
    assertStringIncludes(planReviewDraftDescription(draft), "1 attachment");
    assertStringIncludes(planReviewDraftDescription(draft), "direct Plan edits");
});

Deno.test("Plan Review drafts reject malformed data and a different submitted Plan", () => {
    const draft = createPlanReviewDraft({
        basePlan: "# Initial Plan\n",
        annotations: [],
        globalAttachments: [],
        editedPlan: "# Edited Plan\n",
    });
    const serialized = serializePlanReviewDraft(draft);

    assertEquals(parsePlanReviewDraft(serialized, "# Different Plan\n"), null);
    assertEquals(parsePlanReviewDraft("not json", "# Initial Plan\n"), null);
    assertEquals(parsePlanReviewDraft('{"version":1}', "# Initial Plan\n"), null);
    assertEquals(
        parsePlanReviewDraft(
            serializePlanReviewDraft(createPlanReviewDraft({
                basePlan: "# Initial Plan\n",
                annotations: [],
                globalAttachments: [],
                editedPlan: null,
            })),
            "# Initial Plan\n",
        ),
        null,
    );
});
