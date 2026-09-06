import { join } from "@std/path";
import { getHomeDir } from "../../constants.js";

export type ValidationStateProblem = "plan_missing" | "unknown_plan_status";

export class ValidationStateError extends Error {
    constructor(readonly code: ValidationStateProblem) {
        super(code);
        this.name = "ValidationStateError";
    }
}

/** Diagnostics must never write over the TUI or prevent recovery. */
export async function logValidationFailure(error: Error, operation: string): Promise<void> {
    try {
        const directory = join(getHomeDir(), ".wld", "debug");
        await Deno.mkdir(directory, { recursive: true });
        await Deno.writeTextFile(
            join(directory, "validation-errors.jsonl"),
            JSON.stringify({
                at: new Date().toISOString(),
                operation,
                name: error.name,
                message: error.message,
                stack: error.stack,
            }) + "\n",
            { append: true },
        );
    } catch {
        // A full disk or unavailable home must not mask the original failure.
    }
}
