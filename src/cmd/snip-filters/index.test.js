import { assertEquals, assertStringIncludes } from "@std/assert";
import { runSnipFiltersCommand } from "./index.js";

Deno.test("runSnipFiltersCommand installs, cleans up, and reports status", async () => {
    /** @type {string[]} */
    const logs = [];
    /** @param {string} message */
    const log = (message) => logs.push(message);
    await runSnipFiltersCommand(["install"], {
        __testDeps: {
            installHarnsSnipFiltersForUser: () =>
                Promise.resolve({
                    filtersDir: "/home/me/.config/snip/filters",
                    installed: ["/home/me/.config/snip/filters/deno-test.yaml"],
                    skipped: [{
                        path: "/home/me/.config/snip/filters/deno-lint.yaml",
                        reason: "existing non-Harns filter",
                    }],
                }),
            log,
        },
    });

    assertStringIncludes(logs.join("\n"), "Installed Harns Snip filters");
    assertStringIncludes(logs.join("\n"), "deno-test.yaml");
    assertStringIncludes(logs.join("\n"), "existing non-Harns filter");

    logs.length = 0;
    await runSnipFiltersCommand(["cleanup"], {
        __testDeps: {
            cleanupHarnsSnipFiltersForUser: () =>
                Promise.resolve({
                    filtersDir: "/home/me/.config/snip/filters",
                    removed: ["/home/me/.config/snip/filters/deno-test.yaml"],
                    skipped: [],
                }),
            log,
        },
    });
    assertStringIncludes(logs.join("\n"), "Cleaned up Harns Snip filters");
    assertStringIncludes(logs.join("\n"), "deno-test.yaml");

    logs.length = 0;
    await runSnipFiltersCommand(["status"], {
        __testDeps: {
            getHarnsSnipFilterInstallStatus: () =>
                Promise.resolve({
                    filtersDir: "/home/me/.config/snip/filters",
                    installed: [],
                    conflicts: [],
                    missing: ["/home/me/.config/snip/filters/deno-check.yaml"],
                }),
            log,
        },
    });
    assertStringIncludes(logs.join("\n"), "Missing:");
    assertStringIncludes(logs.join("\n"), "deno-check.yaml");
});

Deno.test("runSnipFiltersCommand rejects unknown action", async () => {
    /** @type {string[]} */
    const errors = [];
    let exitCode = 0;
    await runSnipFiltersCommand(["wat"], {
        __testDeps: {
            error: (/** @type {string} */ message) => errors.push(message),
            exit: (/** @type {number} */ code) => {
                exitCode = code;
            },
        },
    });

    assertEquals(exitCode, 1);
    assertEquals(errors, ["Usage: hns snip-filters [install|cleanup|status]"]);
});
