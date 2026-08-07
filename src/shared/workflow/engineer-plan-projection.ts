import { parsePlanFrontMatter } from "../../plan-store.js";

/** Return the only part of a Plan that an execution Agent can receive. */
export function projectEngineerPlanBody(planContent: string): string {
    return parsePlanFrontMatter(planContent).body.trim();
}
