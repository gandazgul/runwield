/**
 * @module cmd/plans
 * List saved plans.
 */

import { parseArgs } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import { listPlans } from "../../plan-store.js";
import { printCommandHelp } from "../../shared/help-text.js";

/**
 * Handle `plans` command.
 *
 * @param {string[]} argv
 */
export async function runPlansCommand(argv) {
  const parsed = parseArgs(argv, {
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (parsed.help) {
    printCommandHelp("plans");
    return;
  }

  const plans = await listPlans(CWD);
  if (plans.length === 0) {
    console.log("[Harns] No saved plans found.");
    return;
  }

  console.log("\n[Harns] Saved plans:\n");
  for (const p of plans) {
    console.log(`  ${p.name}`);
    console.log(
      `    Status: ${p.attrs.status} | Classification: ${p.attrs.classification} | Complexity: ${p.attrs.complexity}`,
    );
    console.log(`    Summary: ${p.attrs.summary || "(none)"}`);
    console.log(`    Created: ${p.attrs.createdAt}`);
    console.log();
  }
}
