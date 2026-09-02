import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { formatCodeReviewAnnotations, normalizeCodeReviewDecision, runCodeReview } from "./code-review.ts";
import type { BrowserPort } from "../../shared/browser-port.ts";
import { createScriptedReviewBrowser } from "./review-test-fixture.ts";

Deno.test("normalizeCodeReviewDecision handles approvals, annotations, and cancellation", () => {
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
    assertEquals(
        normalizeCodeReviewDecision({
            approved: false,
            feedback: "Revise this.",
            annotations: [],
            conversationTurn: true,
        }),
        {
            approved: false,
            feedback: "Revise this.",
            annotations: [],
            exit: false,
            canceled: false,
            conversationTurn: true,
        },
    );
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

Deno.test("runCodeReview serves the real review surface and loads submitted image bytes", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-code-review-" });
    const imagePath = join(projectRoot, "review.png");
    await Deno.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    const scriptedBrowser = createScriptedReviewBrowser("feedback", {
        approved: false,
        feedback: "Use the attached reference.",
        annotations: [{
            filePath: "src/a.js",
            lineStart: 1,
            text: "Compare with the fixture.",
            images: [{ path: imagePath, name: "review" }],
        }],
    });
    try {
        const result = await runCodeReview({
            planName: "image-review-plan",
            diffText: "diff --git a/src/a.js b/src/a.js\n+change",
            executionCwd: projectRoot,
            browser: scriptedBrowser.browser,
        });

        assertEquals(result.feedback, "Use the attached reference.");
        assertEquals(result.images, [{ base64: "iVBORw==", mimeType: "image/png", name: "review" }]);
        assertEquals(scriptedBrowser.urls.length, 1);
        assertStringIncludes(scriptedBrowser.urls[0], "/review/code?token=");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("runCodeReview cancellation stops the real review server", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-code-review-cancel-" });
    const controller = new AbortController();
    let markOpened: () => void = () => {};
    const opened = new Promise<void>((resolveOpened) => markOpened = resolveOpened);
    const browser: BrowserPort = {
        open: (_url: string) => {
            markOpened();
            return Promise.resolve(true);
        },
    };
    try {
        const pending = runCodeReview({
            planName: "cancel-review",
            diffText: "diff",
            executionCwd: projectRoot,
            signal: controller.signal,
            browser,
        });
        await opened;
        controller.abort();

        assertEquals(await pending, {
            approved: false,
            feedback: "",
            annotations: [],
            exit: true,
            canceled: true,
        });
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
