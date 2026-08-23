import {
    buildPlanEditPanelItem,
    type DirectEditPanelItem,
} from "../../../../third_party/plannotator/packages/editor/directEdits.ts";

const NO_ANNOTATION_FEEDBACK = "No changes detected.";

export function buildRunWieldDirectEditPanel(basePlan: string, editedPlan: string): DirectEditPanelItem[] {
    if (basePlan === editedPlan) return [];
    return [{
        ...buildPlanEditPanelItem(basePlan, editedPlan),
        title: "Direct Plan edits",
        description: "Will be applied to the Plan and included with feedback as review context.",
    }];
}

export function buildRunWieldDirectEditsFeedback(basePlan: string, editedPlan: string): string {
    const panel = buildRunWieldDirectEditPanel(basePlan, editedPlan)[0];
    if (!panel) return "";
    return [
        "# Direct Plan Edits",
        "",
        "The reviewer edited the Plan directly. RunWield has already applied these changes to the Plan file. Preserve them while addressing any other annotations; do not apply this patch a second time.",
        "",
        "```diff",
        panel.diffText.trimEnd(),
        "```",
    ].join("\n");
}

export function composeRunWieldPlanFeedback(
    annotationFeedback: string,
    basePlan: string,
    editedPlan: string,
): string {
    const editsFeedback = buildRunWieldDirectEditsFeedback(basePlan, editedPlan);
    if (!editsFeedback) return annotationFeedback;
    if (!annotationFeedback || annotationFeedback === NO_ANNOTATION_FEEDBACK) return editsFeedback;
    return `${editsFeedback}\n\n---\n\n${annotationFeedback}`;
}
