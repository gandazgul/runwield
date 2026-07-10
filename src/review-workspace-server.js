/**
 * @module review-workspace-server
 * Composition adapter connecting shared review workflows to the Workspace UI.
 */

import { startReviewWorkspaceServer as startWorkspaceServer } from "./ui/workspace/server.js";

/**
 * @param {Parameters<typeof startWorkspaceServer>[0]} options
 * @returns {ReturnType<typeof startWorkspaceServer>}
 */
export function startReviewWorkspaceServer(options) {
    return startWorkspaceServer(options);
}
