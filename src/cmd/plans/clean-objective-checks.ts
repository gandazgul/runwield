import { parseArgs } from "@std/cli/parse-args";
import { CLI_BIN, getCwd } from "../../constants.js";
import { cleanupActivePlanObjectiveCheckMetadata } from "../../plan-store.js";

const HELP = `Usage:
  ${CLI_BIN} plans clean-objective-checks [--dry-run] [--help]

Removes retired Objective Check Front Matter from active, nonterminal Plan files.
Terminal and archived Plans are sealed and are never changed.
`;

export async function runPlansCleanObjectiveChecksCommand(argv: string[]): Promise<void> {
    const parsed = parseArgs(argv, {
        boolean: ["help", "dry-run"],
        alias: { h: "help" },
        unknown: (arg) => {
            throw new Error(`Unknown option: ${arg}`);
        },
    });
    if (parsed.help) {
        console.log(HELP);
        return;
    }
    const results = await cleanupActivePlanObjectiveCheckMetadata(getCwd(), { dryRun: parsed["dry-run"] });
    const changed = results.filter((result) => result.status === "changed");
    const skipped = results.filter((result) => result.status === "skipped_terminal");
    const failed = results.filter((result) => result.status === "failed");
    const action = parsed["dry-run"] ? "would clean" : "cleaned";
    console.log(`[RunWield] ${action} ${changed.length} active Plan(s).`);
    for (const result of changed) {
        console.log(`  ${result.planName}: ${result.removed.join(", ")}`);
    }
    if (skipped.length) console.log(`[RunWield] left ${skipped.length} sealed terminal Plan(s) unchanged.`);
    if (failed.length) {
        for (const result of failed) {
            console.error(`[RunWield] ${result.planName}: ${result.error || "cleanup failed"}`);
        }
        throw new Error(`Objective Check cleanup failed for ${failed.length} Plan(s).`);
    }
}
