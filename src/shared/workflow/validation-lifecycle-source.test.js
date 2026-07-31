import { assert, assertEquals } from "@std/assert";

/**
 * @param {string} source
 * @param {string} marker
 * @returns {string}
 */
function extractFunctionSource(source, marker) {
    const start = source.indexOf(marker);
    assert(start >= 0, `${marker} must exist`);
    const openBrace = source.indexOf("{", start);
    assert(openBrace >= 0, `${marker} must have a body`);

    let depth = 0;
    for (let index = openBrace; index < source.length; index += 1) {
        const char = source[index];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${marker} body was not closed`);
}

Deno.test("runValidationLoop is a single-phase dispatcher", async () => {
    const source = await Deno.readTextFile(new URL("./validation.ts", import.meta.url));
    const functionSource = extractFunctionSource(source, "export async function runValidationLoop");

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
