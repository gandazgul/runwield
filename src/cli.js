/**
 * @module cli
 * Stable JavaScript compatibility entrypoint for RunWield.
 *
 * Usage:
 *   deno run -A src/cli.js "<user request>"
 */

import { createRequire } from "node:module";

if (Deno.build.standalone) {
    globalThis.require = createRequire(import.meta.url);
}

await import("./cli.ts");
