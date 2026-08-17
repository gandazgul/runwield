import { isUnsupportedModelExecutionBackendError } from "../models/model-execution.ts";
import { getSettingsManager } from "../settings.js";
import type { SessionRuntime } from "./session-runtime.js";

export interface ModelActivationResult {
    status: "active" | "deferred";
    message?: string;
}

/** Persist the default used by future sessions without claiming an active session changed. */
export async function setDefaultModelSelection(
    projectRoot: string,
    model: string,
    provider?: string,
): Promise<void> {
    const settingsManager = getSettingsManager(projectRoot);
    await settingsManager.setDefaultModel(model);
    await settingsManager.setDefaultProvider(provider || "");
}

/**
 * Reconfigure the real Runtime session and persist the user's selection in the
 * settings scoped to that session's project.
 */
export async function setActiveSessionModel(
    runtime: SessionRuntime,
    sessionId: string,
    model: string,
    provider?: string,
): Promise<ModelActivationResult> {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (!snapshot) throw new Error("Cannot set model for a missing runtime session.");

    try {
        const result = await runtime.reconfigureSessionModel(sessionId, model, provider || "");
        if (!result?.ok) throw new Error("The active Session could not switch models.");
    } catch (error) {
        if (!(error instanceof Error) || !isUnsupportedModelExecutionBackendError(error)) throw error;
        try {
            await setDefaultModelSelection(snapshot.cwd, model, provider);
        } catch (persistenceError) {
            console.error(`Failed to persist deferred model selection: ${persistenceError}`);
        }
        return {
            status: "deferred",
            message: `${error.message} Saved ${
                provider ? `${provider}/${model}` : model
            } for later. The current Session was not switched.`,
        };
    }

    try {
        await setDefaultModelSelection(snapshot.cwd, model, provider);
    } catch (error) {
        console.error(`Failed to persist model selection: ${error}`);
    }
    return { status: "active" };
}
