import { listUserModelOptions } from "../shared/session/user-selection.ts";
import type { SessionRuntime } from "../shared/session/session-runtime.ts";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

/**
 * Expose the same selectable models and active choice as the other Session surfaces.
 */
export async function buildAcpModelOptions(runtime: SessionRuntime, sessionId: string): Promise<SessionConfigOption[]> {
    const models = await listUserModelOptions();
    const active = runtime.getSessionSnapshot(sessionId)?.activeModel;
    if (!active?.model) return [];
    const currentValue = active.provider && !active.model.startsWith(`${active.provider}/`)
        ? `${active.provider}/${active.model}`
        : active.model;
    const options = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        name: `${model.name} (${model.provider})`,
    }));
    // Saved Sessions can retain a model whose credentials are no longer available.
    // Keep the reported current value honest while offering usable alternatives.
    if (!options.some((option) => option.value === currentValue)) {
        options.unshift({ value: currentValue, name: currentValue });
    }
    return [{ id: "model", name: "Model", category: "model", type: "select", currentValue, options }];
}
