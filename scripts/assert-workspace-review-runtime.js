/**
 * Assert that the built Workspace runtime renders the real Astro review pages.
 * This is a release quality gate: Plan/Code review must not silently degrade to
 * a missing-assets or fallback page in standalone binaries.
 */

import { join, resolve, toFileUrl } from "@std/path";

const DEFAULT_RUNTIME_ENTRY = "dist/workspace-runtime/server.mjs";

/** @param {string} message */
function fail(message) {
    throw new Error(message);
}

/**
 * @param {string} html
 * @param {string} label
 */
function assertRealReviewHtml(html, label) {
    if (html.includes("Workspace review UI assets are unavailable")) {
        fail(`${label} rendered the old unavailable-assets page.`);
    }
    if (html.includes("built-in review surface")) {
        fail(`${label} rendered the static fallback instead of the Astro review UI.`);
    }
    if (html.includes("Workspace Astro build unavailable")) {
        fail(`${label} rendered the Workspace build-unavailable error.`);
    }
    if (!html.includes("data-astro-review-shell")) fail(`${label} did not render the review shell.`);
    if (!html.includes("astro-island")) fail(`${label} did not include Astro island hydration markup.`);
    if (!html.includes("/_astro/")) fail(`${label} did not reference built Astro client assets.`);
}

/**
 * @param {string} runtimeEntry
 * @param {string} route
 * @param {Record<string, unknown>} payload
 */
async function assertReviewRoute(runtimeEntry, route, payload) {
    const absoluteRuntimeEntry = resolve(runtimeEntry);
    const entry = await import(toFileUrl(absoluteRuntimeEntry).href);
    if (typeof entry.handle !== "function") fail(`${runtimeEntry} does not export handle().`);

    const token = String(payload.token || "review-runtime-token");
    const headers = new Headers();
    headers.set("x-runwield-workspace-cwd", Deno.cwd());
    headers.set("x-runwield-review-payload", encodeURIComponent(JSON.stringify(payload)));
    const response = await entry.handle(
        new Request(`http://localhost${route}?token=${encodeURIComponent(token)}`, { headers }),
    );
    const html = await response.text();
    if (response.status !== 200) fail(`${route} returned ${response.status}: ${html.slice(0, 200)}`);
    assertRealReviewHtml(html, route);
}

/** @param {string[]} [args] */
export async function main(args = Deno.args) {
    const runtimeEntry = args[0] || DEFAULT_RUNTIME_ENTRY;
    await assertReviewRoute(runtimeEntry, "/review/plan", {
        plan: "# Release quality gate Plan\n",
        planPath: "plans/release-quality-gate.md",
        token: "plan-review-runtime-token",
        mode: "workflow",
    });
    await assertReviewRoute(runtimeEntry, "/review/code", {
        rawPatch:
            "diff --git a/src/example.js b/src/example.js\n--- a/src/example.js\n+++ b/src/example.js\n@@ -1 +1,2 @@\n export const a = 1;\n+export const b = 2;\n",
        gitRef: "release quality gate diff",
        agentCwd: Deno.cwd(),
        token: "code-review-runtime-token",
        mode: "workflow",
    });
    console.log(`Workspace review runtime quality gate passed for ${join(Deno.cwd(), runtimeEntry)}.`);
}

if (import.meta.main) {
    await main();
    Deno.exit(0);
}
