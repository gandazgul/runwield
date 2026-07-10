import { assertEquals, assertStringIncludes } from "@std/assert";
import {
    formatCodeReviewAnnotations,
    loadReviewEditorHtml,
    normalizeCodeReviewDecision,
    runPlannotatorCodeReview,
} from "./code-review.js";

Deno.test("normalizeCodeReviewDecision handles approvals, feedback, annotations, and exits", () => {
    assertEquals(
        normalizeCodeReviewDecision({
            approved: true,
            feedback: "ship it",
            annotations: [{ file: "src/a.js", line: 3, text: "nice" }],
        }),
        {
            approved: true,
            feedback: "ship it",
            annotations: [{ file: "src/a.js", line: 3, text: "nice" }],
            exit: false,
            canceled: false,
        },
    );

    assertEquals(normalizeCodeReviewDecision({ canceled: true }), {
        approved: false,
        feedback: "",
        annotations: [],
        exit: true,
        canceled: true,
    });
});

Deno.test("formatCodeReviewAnnotations renders file, line, and text", () => {
    assertEquals(
        formatCodeReviewAnnotations([
            { file: "src/a.js", line: 12, text: "Rename this." },
            { path: "src/b.js", comment: "Missing test." },
            { filePath: "src/c.js", line: 4, comment: "From review surface." },
        ]),
        "1. src/a.js:12\nRename this.\n\n2. src/b.js\nMissing test.\n\n3. src/c.js:4\nFrom review surface.",
    );
});

Deno.test("loadReviewEditorHtml reads the package review HTML asset", async () => {
    const html = await loadReviewEditorHtml();

    assertStringIncludes(html, "<!DOCTYPE html>");
});

Deno.test("runPlannotatorCodeReview delegates launching through the code review surface seam", async () => {
    /** @type {string[]} */
    const messages = [];
    /** @type {any[]} */
    const launcherOptions = [];
    let stopped = false;

    const result = await runPlannotatorCodeReview({
        planName: "surface-seam-plan",
        diffText: "diff --git a/src/a.js b/src/a.js\n+change",
        executionCwd: "/tmp/worktree",
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
        __deps: {
            startCodeReviewSurface: (options) => {
                launcherOptions.push(options);
                return Promise.resolve({
                    url: "http://localhost:2468",
                    opened: false,
                    waitForDecision: () => Promise.resolve({ approved: true, feedback: "ok" }),
                    stop: () => {
                        stopped = true;
                    },
                });
            },
            loadReviewEditorHtml: () => Promise.reject(new Error("should not load directly")),
            openInDefaultBrowser: () => Promise.reject(new Error("should not open directly")),
            startReviewServer: /** @type {any} */ (() => Promise.reject(new Error("should not start directly"))),
        },
    });

    assertEquals(result.approved, true);
    assertEquals(result.feedback, "ok");
    assertEquals(stopped, true);
    assertEquals(launcherOptions, [
        {
            rawPatch: "diff --git a/src/a.js b/src/a.js\n+change",
            gitRef: "RunWield workflow diff: surface-seam-plan",
            agentCwd: "/tmp/worktree",
            startReviewServer: launcherOptions[0].startReviewServer,
            loadReviewEditorHtml: launcherOptions[0].loadReviewEditorHtml,
            openInDefaultBrowser: launcherOptions[0].openInDefaultBrowser,
        },
    ]);
    assertEquals(typeof launcherOptions[0].startReviewServer, "function");
    assertEquals(typeof launcherOptions[0].loadReviewEditorHtml, "function");
    assertEquals(typeof launcherOptions[0].openInDefaultBrowser, "function");
    assertEquals(messages, [
        "Code review UI available at: http://localhost:2468",
        "Could not auto-open browser. Open manually: http://localhost:2468",
    ]);
});

Deno.test("runPlannotatorCodeReview disables input while waiting for reviewer decision", async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {(value: { approved: boolean, feedback?: string }) => void} */
    let resolveDecision = () => {};
    const decisionPromise = new Promise((resolve) => {
        resolveDecision = resolve;
    });

    const reviewPromise = runPlannotatorCodeReview({
        planName: "input-disabled-plan",
        diffText: "diff --git a/src/a.js b/src/a.js\n+change",
        executionCwd: "/tmp/worktree",
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: () => {},
            disableInput: () => events.push("disable"),
            enableInput: () => events.push("enable"),
        }),
        __deps: {
            startCodeReviewSurface: () =>
                Promise.resolve({
                    url: "http://localhost:2468",
                    opened: true,
                    waitForDecision: () => {
                        events.push("wait");
                        return decisionPromise;
                    },
                    stop: () => {
                        events.push("stop");
                    },
                }),
        },
    });

    await Promise.resolve();
    await Promise.resolve();
    assertEquals(events, ["disable", "wait"]);

    resolveDecision({ approved: true, feedback: "ok" });
    const result = await reviewPromise;

    assertEquals(result.approved, true);
    assertEquals(events, ["disable", "wait", "enable", "stop"]);
});

Deno.test("runPlannotatorCodeReview reports browser fallback and still waits for decision", async () => {
    /** @type {string[]} */
    const messages = [];
    let stopped = false;

    const result = await runPlannotatorCodeReview({
        planName: "browser-fallback-plan",
        diffText: "diff --git a/src/a.js b/src/a.js\n+change",
        executionCwd: "/tmp/worktree",
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
        __deps: {
            loadReviewEditorHtml: () => Promise.resolve("<html>review</html>"),
            openInDefaultBrowser: () => Promise.resolve(false),
            startReviewServer: /** @type {any} */ (() =>
                Promise.resolve({
                    url: "http://localhost:5678",
                    waitForDecision: () => Promise.resolve({ approved: true }),
                    stop: () => {
                        stopped = true;
                    },
                })),
        },
    });

    assertEquals(result.approved, true);
    assertEquals(stopped, true);
    assertEquals(messages, [
        "Code review UI available at: http://localhost:5678",
        "Could not auto-open browser. Open manually: http://localhost:5678",
    ]);
});

Deno.test("runPlannotatorCodeReview starts server with diff payload and always stops it", async () => {
    /** @type {any[]} */
    const serverOptions = [];
    /** @type {string[]} */
    const openedUrls = [];
    let stopped = false;

    const result = await runPlannotatorCodeReview({
        planName: "human-review-plan",
        diffText: "diff --git a/src/a.js b/src/a.js\n+change",
        executionCwd: "/tmp/worktree",
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: () => {},
        }),
        __deps: {
            loadReviewEditorHtml: () => Promise.resolve("<html>review</html>"),
            openInDefaultBrowser: (url) => {
                openedUrls.push(url);
                return Promise.resolve(true);
            },
            startReviewServer: /** @type {any} */ ((/** @type {any} */ options) => {
                serverOptions.push(options);
                return Promise.resolve({
                    url: "http://localhost:1234",
                    waitForDecision: () => Promise.resolve({ approved: true, feedback: "ok" }),
                    stop: () => {
                        stopped = true;
                    },
                });
            }),
        },
    });

    assertEquals(result.approved, true);
    assertEquals(result.feedback, "ok");
    assertEquals(stopped, true);
    assertEquals(openedUrls, ["http://localhost:1234"]);
    assertEquals(serverOptions[0], {
        rawPatch: "diff --git a/src/a.js b/src/a.js\n+change",
        gitRef: "RunWield workflow diff: human-review-plan",
        htmlContent: "<html>review</html>",
        origin: "runwield",
        agentCwd: "/tmp/worktree",
    });
});
