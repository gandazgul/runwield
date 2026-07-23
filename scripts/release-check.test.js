import { assertEquals, assertRejects } from "@std/assert";
import {
    assertReviewAssetsLoad,
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
