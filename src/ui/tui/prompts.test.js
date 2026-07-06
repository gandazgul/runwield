import { assertEquals } from "@std/assert";
import { __setPromptDepsForTest, confirm, promptText, select } from "./prompts.js";

class FakeContainer {
    /** @type {unknown[]} */
    children = [];

    /** @param {unknown} child */
    addChild(child) {
        this.children.push(child);
    }

    /** @param {number} w */
    render(w) {
        return [`render:${w}`];
    }

    invalidate() {}
}

class FakeText {
    /** @param {string} text */
    constructor(text) {
        this.text = text;
    }
}

class FakeSelectList {
    /** @type {undefined | ((item: { value: string }) => void)} */
    onSelect;
    /** @type {undefined | (() => void)} */
    onCancel;

    /** @param {Array<{ value: string }>} options */
    constructor(options) {
        this.options = options;
    }

    /** @param {string} data */
    handleInput(data) {
        if (data === "escape") {
            this.onCancel?.();
            return;
        }
        const index = Number.parseInt(data, 10);
        this.onSelect?.(this.options[Number.isNaN(index) ? 0 : index]);
    }
}

class FakeInput {
    value = "";
    /** @type {undefined | ((value: string) => void)} */
    onSubmit;
    /** @type {undefined | (() => void)} */
    onEscape;

    /** @param {string} value */
    setValue(value) {
        this.value = value;
    }

    /** @param {string} data */
    handleInput(data) {
        if (data === "escape") {
            this.onEscape?.();
            return;
        }
        this.onSubmit?.(data);
    }
}

/**
 * @param {string[]} inputs
 * @returns {{ logs: string[], restore: () => void }}
 */
function installFallbackDeps(inputs) {
    /** @type {string[]} */
    const logs = [];
    const origLog = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    __setPromptDepsForTest({
        getTUI: () => {
            throw new Error("no tui");
        },
        readUserInput: () => Promise.resolve(inputs.shift() ?? ""),
    });
    return {
        logs,
        restore() {
            console.log = origLog;
            __setPromptDepsForTest();
        },
    };
}

/**
 * @returns {{ overlays: Array<{ component: { handleInput(data: string): void, render(w: number): unknown }, hidden: boolean }>, renderCount: () => number, restore: () => void }}
 */
function installTuiDeps() {
    /** @type {Array<{ component: { handleInput(data: string): void, render(w: number): unknown }, hidden: boolean }>} */
    const overlays = [];
    let renders = 0;
    __setPromptDepsForTest(
        /** @type {any} */ ({
            Container: FakeContainer,
            Input: FakeInput,
            SelectList: FakeSelectList,
            Text: FakeText,
            getSelectListTheme: () => ({}),
            theme: {
                fg: (
                    /** @type {string} */ _slot,
                    /** @type {string} */ text,
                ) => text,
                bold: (/** @type {string} */ text) => text,
            },
            getTUI: () => /** @type {any} */ ({
                tui: {
                    requestRender: () => {
                        renders += 1;
                    },
                    showOverlay: (/** @type {unknown} */ component) => {
                        const entry = {
                            component:
                                /** @type {{ handleInput(data: string): void, render(w: number): unknown }} */ (component),
                            hidden: false,
                        };
                        overlays.push(entry);
                        return {
                            hide: () => {
                                entry.hidden = true;
                            },
                        };
                    },
                },
            }),
        }),
    );
    return {
        overlays,
        renderCount: () => renders,
        restore: () => __setPromptDepsForTest(),
    };
}

Deno.test("select fallback accepts option numbers, values, and invalid input", async () => {
    const fallback = installFallbackDeps(["2", "yes", "missing", ""]);
    try {
        const options = [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
        ];
        assertEquals(await select("Pick", options), "no");
        assertEquals(await select("Pick", options), "yes");
        assertEquals(await select("Pick", options), null);
        assertEquals(await select("Pick", options), null);
        assertEquals(fallback.logs.some((line) => line.includes("Select option number")), true);
    } finally {
        fallback.restore();
    }
});

Deno.test("promptText fallback handles defaults and required empty values", async () => {
    const fallback = installFallbackDeps(["", "", "typed"]);
    try {
        assertEquals(await promptText("Name", { defaultValue: "Ada" }), "Ada");
        assertEquals(await promptText("Required", { allowEmpty: false }), "");
        assertEquals(await promptText("Typed", { placeholder: "say it" }), "typed");
        assertEquals(fallback.logs.some((line) => line.includes("Default: Ada")), true);
    } finally {
        fallback.restore();
    }
});

Deno.test("confirm maps selected yes to true", async () => {
    const fallback = installFallbackDeps(["1"]);
    try {
        assertEquals(await confirm("Continue?"), true);
    } finally {
        fallback.restore();
    }
});

Deno.test("select TUI overlay resolves selected value and cancellation", async () => {
    const tui = installTuiDeps();
    try {
        const first = select("Pick", [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ]);
        tui.overlays[0].component.handleInput("1");
        assertEquals(await first, "b");
        assertEquals(tui.overlays[0].hidden, true);
        assertEquals(tui.renderCount(), 1);

        const second = select("Pick", [{ value: "a", label: "A" }]);
        tui.overlays[1].component.handleInput("escape");
        assertEquals(await second, null);
        assertEquals(tui.overlays[1].hidden, true);
    } finally {
        tui.restore();
    }
});

Deno.test("promptText TUI overlay resolves submit, required blank, and escape", async () => {
    const tui = installTuiDeps();
    try {
        const submitted = promptText("Name", { defaultValue: "Ada" });
        tui.overlays[0].component.handleInput("");
        assertEquals(await submitted, "Ada");
        assertEquals(tui.overlays[0].hidden, true);

        const required = promptText("Required", { allowEmpty: false });
        tui.overlays[1].component.handleInput("");
        assertEquals(tui.overlays[1].hidden, false);
        tui.overlays[1].component.handleInput("Grace");
        assertEquals(await required, "Grace");
        assertEquals(tui.overlays[1].hidden, true);

        const canceled = promptText("Cancel");
        tui.overlays[2].component.handleInput("escape");
        assertEquals(await canceled, null);
    } finally {
        tui.restore();
    }
});
