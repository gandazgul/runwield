import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    assertExtractedBundledAgentReferenceFiles,
    assertReviewAssetsLoad,
    BUNDLED_AGENT_REFERENCE_FILES,
    collectNestedReviewAssetUrls,
    collectReviewAssetUrls,
    readReviewUrl,
} from "./release-check.js";

Deno.test("readReviewUrl extracts Plan review URL from command output", () => {
    assertEquals(
        readReviewUrl("[RunWield] Plan read-only view: http://127.0.0.1:1234/review/plan?token=abc-123\n"),
        "http://127.0.0.1:1234/review/plan?token=abc-123",
    );
});

Deno.test("collectReviewAssetUrls finds Astro assets needed by review HTML", () => {
    const html =
        '<link rel="stylesheet" href="/_astro/app.css"><astro-island component-url="/_astro/Review.js"></astro-island>';

    assertEquals(collectReviewAssetUrls(html, "http://127.0.0.1:1234/review/plan?token=test"), [
        "http://127.0.0.1:1234/_astro/app.css",
        "http://127.0.0.1:1234/_astro/Review.js",
    ]);
});

Deno.test("collectNestedReviewAssetUrls finds dynamic import chunks", () => {
    const source =
        'const chunk = () => import("./ArtifactReadSurface.js"); import { x } from "./client.js"; import "./side-effect.js";';

    assertEquals(collectNestedReviewAssetUrls(source, "http://127.0.0.1:1234/_astro/Review.js"), [
        "http://127.0.0.1:1234/_astro/ArtifactReadSurface.js",
        "http://127.0.0.1:1234/_astro/client.js",
        "http://127.0.0.1:1234/_astro/side-effect.js",
    ]);
});

Deno.test("assertExtractedBundledAgentReferenceFiles accepts copied document-format references", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "runwield-reference-home-" });
    try {
        const cacheDir = join(homeDir, ".wld", "bundled-agent-definitions", "document-formats");
        await Deno.mkdir(cacheDir, { recursive: true });
        for (const fileName of BUNDLED_AGENT_REFERENCE_FILES) {
            const source = await Deno.readTextFile(join("src", "agent-definitions", "document-formats", fileName));
            await Deno.writeTextFile(join(cacheDir, fileName), source);
        }

        await assertExtractedBundledAgentReferenceFiles(homeDir);
    } finally {
        await Deno.remove(homeDir, { recursive: true });
    }
});

Deno.test("assertExtractedBundledAgentReferenceFiles rejects missing document-format references", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "runwield-reference-home-missing-" });
    try {
        await assertRejects(
            () => assertExtractedBundledAgentReferenceFiles(homeDir),
            Error,
            "Release binary did not extract bundled agent reference file",
        );
    } finally {
        await Deno.remove(homeDir, { recursive: true });
    }
});

Deno.test("assertReviewAssetsLoad fails when a dynamic review chunk is missing", async () => {
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/_astro/Review.js") {
            return new Response('export const load = () => import("./MissingChunk.js");', {
                headers: { "content-type": "application/javascript" },
            });
        }
        return new Response("Not found", { status: 404 });
    });
    const pageUrl = `http://127.0.0.1:${server.addr.port}/review/plan?token=test`;
    const html = '<astro-island component-url="/_astro/Review.js"></astro-island>';

    try {
        await assertRejects(
            () => assertReviewAssetsLoad(pageUrl, html),
            Error,
            "Review UI asset failed to load (404)",
        );
    } finally {
        await server.shutdown();
    }
});
