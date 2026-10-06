/**
 * Shared remote Workspace development-mode policy.
 *
 * Remote Shared Space routes are intentionally available in Astro development
 * only when the caller opts into remote mode. Local Workspace development must
 * not expose remote review or API authority by accident.
 */

export const REMOTE_WORKSPACE_MODE = "remote";

export interface RemoteDevelopmentModeOptions {
    isDevelopment: boolean;
    workspaceMode: string | undefined;
}

export function isRemoteDevelopmentModeEnabled(
    { isDevelopment, workspaceMode }: RemoteDevelopmentModeOptions,
): boolean {
    return isDevelopment && workspaceMode === REMOTE_WORKSPACE_MODE;
}
