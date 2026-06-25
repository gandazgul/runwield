/**
 * Dev server entry for Vite dev mode with HMR.
 * Exports the Fresh App instance — the Vite plugin handles the dev server.
 * Token auth is relaxed for local development (any token works in dev mode).
 */

import { createWorkspaceApp } from "./server.js";

export const app = createWorkspaceApp({
    cwd: Deno.cwd(),
    token: "dev",
});
