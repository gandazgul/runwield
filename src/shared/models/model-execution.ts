import type { RunWieldModel } from "./model-registry.ts";
import { remotePersonalResourcesActive } from "../remote/personal-resources.ts";

export class UnsupportedModelExecutionBackendError extends Error {
    readonly provider: string;
    readonly model: string;
    readonly executionBackend: string;

    constructor(model: RunWieldModel | Pick<RunWieldModel, "provider" | "id" | "executionBackend">) {
        const backend = model.executionBackend ||
            (model.provider === "claude-cli" || model.provider === "agy-cli" ? model.provider : "pi");
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

export function assertModelExecutionBackendSupported(
    model: RunWieldModel | Pick<RunWieldModel, "provider" | "id" | "executionBackend"> | undefined,
    remoteContext = remotePersonalResourcesActive(),
): void {
    if (!model) return;
    const backend = model.executionBackend || "pi";
    // A remote project must never launch an external CLI on the remote host.
    // Check the provider as well as metadata: saved selections only retain provider/id.
    if (
        remoteContext &&
        (backend === "claude-cli" || backend === "agy-cli" || model.provider === "claude-cli" ||
            model.provider === "agy-cli")
    ) throw new UnsupportedModelExecutionBackendError(model);
    if (backend === "pi" || backend === "claude-cli" || backend === "agy-cli") return;
    throw new UnsupportedModelExecutionBackendError(model);
}
