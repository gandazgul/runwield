import { loadPlanBodyById, savePlanBodyById } from "../../../plan-store.js";

const plan = await loadPlanBodyById(Deno.args[0], Deno.args[1]);
console.log("ready");
await savePlanBodyById(Deno.args[0], Deno.args[1], "# Demo\n\n## Context\n\nWorkspace edit.\n", plan.bodyHash, {
    expectedRevision: plan.revision,
});
