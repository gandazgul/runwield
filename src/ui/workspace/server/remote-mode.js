/**
 * Shared remote Workspace development-mode policy.
 *
 * Remote Shared Space routes are intentionally available in Astro development
 * only when the caller opts into remote mode. Local Workspace development must
 * not expose remote review or API authority by accident.
 */

export const REMOTE_WORKSPACE_MODE = "remote";

/**
 * @typedef {Object} RemoteDevelopmentModeOptions
 * @property {boolean} isDevelopment
 * @property {string | undefined} workspaceMode
 */

/**
 * @param {RemoteDevelopmentModeOptions} options
 * @returns {boolean}
 */
export function isRemoteDevelopmentModeEnabled({ isDevelopment, workspaceMode }) {
    return isDevelopment && workspaceMode === REMOTE_WORKSPACE_MODE;
}
