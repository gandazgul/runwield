import type { RunWieldModel } from "./model-registry.ts";

export class UnsupportedModelExecutionBackendError extends Error {
    readonly provider: string;
    readonly model: string;
    readonly executionBackend: string;

    constructor(model: RunWieldModel) {
        const backend = model.executionBackend || "pi";
        super(`Unsupported model execution backend "${backend}" for ${model.provider}/${model.id}.`);
        this.name = "UnsupportedModelExecutionBackendError";
        this.provider = model.provider;
        this.model = model.id;
        this.executionBackend = backend;
    }
}

export function isUnsupportedModelExecutionBackendError(
    error: Error | string,
): error is UnsupportedModelExecutionBackendError {
    return error instanceof UnsupportedModelExecutionBackendError;
}

export function assertModelExecutionBackendSupported(model: RunWieldModel | undefined): void {
    if (!model) return;
    const backend = model.executionBackend || "pi";
    if (backend === "pi" || backend === "claude-cli" || backend === "agy-cli") return;
    throw new UnsupportedModelExecutionBackendError(model);
}
