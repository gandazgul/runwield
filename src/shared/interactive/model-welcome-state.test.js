import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
    _setTestModelWelcomeStatePath,
    hasModelWelcomeBeenShown,
    readModelWelcomeState,
    recordModelWelcomeShown,
} from "./model-welcome-state.js";

/**
 * @param {(path: string) => Promise<void>} fn
 */
async function withTempState(fn) {
    const dir = await Deno.makeTempDir({ prefix: "runwield-model-welcome-state-" });
    const path = join(dir, "model-welcome-state.json");
    _setTestModelWelcomeStatePath(path);
    try {
        await fn(path);
    } finally {
        _setTestModelWelcomeStatePath(null);
        await Deno.remove(dir, { recursive: true });
    }
}

Deno.test("model welcome state treats a missing file as not shown", async () => {
    await withTempState(async () => {
        assertEquals(await hasModelWelcomeBeenShown(), false);
        assertEquals(await readModelWelcomeState(), { shown: false, shownAt: null });
    });
});

Deno.test("recordModelWelcomeShown persists the first shown timestamp", async () => {
    await withTempState(async () => {
        await recordModelWelcomeShown();
        const first = await readModelWelcomeState();

        assertEquals(first.shown, true);
        assertEquals(typeof first.shownAt, "string");

        await recordModelWelcomeShown();
        const second = await readModelWelcomeState();
        assertEquals(second, first);
    });
});

Deno.test("model welcome state treats invalid JSON as not shown", async () => {
    await withTempState(async (path) => {
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, "not-json");

        assertEquals(await hasModelWelcomeBeenShown(), false);
        assertEquals(await readModelWelcomeState(), { shown: false, shownAt: null });
    });
});
