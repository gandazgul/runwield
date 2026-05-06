import { assertEquals, assertMatch } from "@std/assert";
import { resetTuiState } from "../command-helpers.js";
import { buildRepairPrompt } from "../../shared/workflow/workflow.js";

Deno.test("buildRepairPrompt includes plan name and error", () => {
    const text = buildRepairPrompt("my-plan", "bad format");
    assertMatch(text, /my-plan/);
    assertMatch(text, /bad format/);
});

Deno.test("resetTuiState re-enables input and focus", () => {
    let busy = true;
    let enabled = false;
    let focused = false;

    const editor = /** @type {any} */ ({ disableSubmit: true });
    const uiAPI = /** @type {any} */ ({
        setBusy: (/** @type {boolean} */ v) => {
            busy = v;
        },
        enableInput: () => {
            enabled = true;
        },
    });
    const tui = /** @type {any} */ ({
        setFocus: () => {
            focused = true;
        },
    });

    resetTuiState(editor, uiAPI, tui);

    assertEquals(editor.disableSubmit, false);
    assertEquals(busy, false);
    assertEquals(enabled, true);
    assertEquals(focused, true);
});
