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
        },
    );

    assertEquals(normalizeCodeReviewDecision({ canceled: true }), {
        approved: false,
        feedback: "",
        annotations: [],
        exit: true,
    });
});

Deno.test("formatCodeReviewAnnotations renders file, line, and text", () => {
    assertEquals(
        formatCodeReviewAnnotations([
            { file: "src/a.js", line: 12, text: "Rename this." },
            { path: "src/b.js", comment: "Missing test." },
        ]),
        "1. src/a.js:12\nRename this.\n\n2. src/b.js\nMissing test.",
    );
});

Deno.test("loadReviewEditorHtml reads the package review HTML asset", async () => {
    const html = await loadReviewEditorHtml();

    assertStringIncludes(html, "<!DOCTYPE html>");
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
