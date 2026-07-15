import { assertEquals } from "@std/assert";
import { formatCodeReviewAnnotations, normalizeCodeReviewDecision, runCodeReview } from "./code-review.js";

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

Deno.test("runCodeReview owns the browser surface and loads image bytes", async () => {
    const worktree = await Deno.makeTempDir();
    const imagePath = `${worktree}/review.png`;
    await Deno.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    let stopped = false;
    try {
        const result = await runCodeReview({
            planName: "image-review-plan",
            diffText: "diff --git a/src/a.js b/src/a.js\n+change",
            executionCwd: worktree,
            __deps: {
                startCodeReviewSurface: () =>
                    Promise.resolve({
                        url: "http://localhost:2468",
                        opened: true,
                        waitForDecision: () =>
                            Promise.resolve({
                                approved: false,
                                feedback: "Use the attached reference.",
                                images: [{ path: imagePath, name: "review" }],
                            }),
                        stop: () => {
                            stopped = true;
                        },
                    }),
            },
        });

        assertEquals(result.images, [{ base64: "iVBORw==", mimeType: "image/png", name: "review" }]);
        assertEquals(stopped, true);
    } finally {
        await Deno.remove(worktree, { recursive: true });
    }
});

Deno.test("runCodeReview cancellation is driven by its AbortSignal", async () => {
    const controller = new AbortController();
    let stopped = false;
    const pending = runCodeReview({
        planName: "cancel-review",
        diffText: "diff",
        executionCwd: Deno.cwd(),
        signal: controller.signal,
        __deps: {
            startCodeReviewSurface: () =>
                Promise.resolve({
                    url: "http://localhost:2468",
                    opened: true,
                    waitForDecision: () => new Promise(() => {}),
                    stop: () => {
                        stopped = true;
                    },
                }),
        },
    });
    await Promise.resolve();
    controller.abort();

    assertEquals(await pending, {
        approved: false,
        feedback: "",
        annotations: [],
        exit: true,
        canceled: true,
    });
    assertEquals(stopped, true);
});
