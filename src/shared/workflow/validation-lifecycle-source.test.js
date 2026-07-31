import { assert, assertEquals } from "@std/assert";

Deno.test("runValidationLoop is a single-phase dispatcher", async () => {
    const source = await Deno.readTextFile(new URL("./validation.ts", import.meta.url));
    const start = source.indexOf("export async function runValidationLoop");
    const end = source.indexOf("\n}\n\nfunction getValidationPlanStatus", start) + 3;
    const functionSource = source.slice(start, end);

    assert(start >= 0, "runValidationLoop must exist");
    assert(functionSource.split("\n").length < 200, "runValidationLoop should stay under 200 lines");
    assert(!functionSource.includes("while"), "runValidationLoop must not contain while loops");
    assert(!functionSource.includes("for ("), "runValidationLoop must not loop over phases");
});

Deno.test("legacy validation drivers are not reachable", async () => {
    const lifecycleSource = await Deno.readTextFile(new URL("./validation.ts", import.meta.url));
    const legacySource = await Deno.readTextFile(new URL("./validation-legacy.ts", import.meta.url));

    assertEquals(lifecycleSource.includes("runLegacyValidationMachine"), false);
    assertEquals(lifecycleSource.includes("runLegacyPhaseAdapter"), false);
    assertEquals(lifecycleSource.includes("ValidationPhaseComplete"), false);
    assertEquals(lifecycleSource.includes("pauseForExecutionContinuation"), false);
    assertEquals(legacySource.includes("runLegacyValidationMachine"), false);
    assertEquals(legacySource.includes("while (!executionComplete"), false);
    assertEquals(legacySource.includes("pauseForExecutionContinuation"), false);
});
