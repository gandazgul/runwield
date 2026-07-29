/**
 * Dev server entry for Astro/Vite mode with HMR.
 * Exports the Workspace server wrapper for local development.
 * Token auth is disabled in dev mode (localhost-only, no exposure risk).
 */

import { createWorkspaceApp } from "./server.js";

export const app = createWorkspaceApp({
    // Astro dev-server entry module, never loaded by the test suite.
    // deno-lint-ignore runwield/no-module-scope-process-state
    cwd: Deno.cwd(),
    token: "",
    skipTokenCheck: true,
});
