/**
 * Dev server entry for Astro/Vite mode with HMR.
 * Exports the Workspace server wrapper for local development.
 * Token auth is disabled in dev mode (localhost-only, no exposure risk).
 */

import { createWorkspaceApp } from "./server.js";

export const app = createWorkspaceApp({
    cwd: Deno.cwd(),
    token: "",
    skipTokenCheck: true,
});
