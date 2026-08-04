/**
 * @module shared/model-validation
 * Shared strict model input parsing/validation helpers.
 */

import { getModelRegistry } from "./model-registry.ts";

export interface ActiveModelState {
    model: string;
    provider?: string;
}

export interface SelectableModelReference {
    provider: string;
    id: string;
    executionBackend?: string;
}

export interface TemplateModelRegistry {
    find(provider: string, model: string): SelectableModelReference | null | undefined;
    isSelectable?(model: SelectableModelReference | null | undefined): boolean;
    hasConfiguredAuth(model: SelectableModelReference | null | undefined): boolean;
}

export type ProviderModelParseResult = { ok: true; provider: string; id: string } | { ok: false };
export type TemplateModelResolution = { ok: true; provider: string; id: string } | { ok: false };

/**
 * Parse a strict model reference in `provider/id` format.
 */
export function parseProviderModel(value: string): ProviderModelParseResult {
    const text = value.trim();
    const slashIndex = text.indexOf("/");

    if (slashIndex <= 0 || slashIndex === text.length - 1) return { ok: false };

    const provider = text.slice(0, slashIndex).trim();
    const id = text.slice(slashIndex + 1).trim();

    if (!provider || !id) return { ok: false };

    return { ok: true, provider, id };
}

/**
 * Format a HostedSession model state as the provider/model reference accepted
 * by invocation overrides without duplicating an already-qualified provider.
 */
export function formatProviderModelReference(activeModel: ActiveModelState): string {
    if (!activeModel.provider) return activeModel.model;
    return activeModel.model.startsWith(`${activeModel.provider}/`)
        ? activeModel.model
        : `${activeModel.provider}/${activeModel.model}`;
}

/**
 * Resolve and validate a model declared by a prompt template or workflow.
 * Requires strict `provider/id` format and selection eligibility.
 */
export function resolveTemplateModel(
    templateModel: string,
    modelRegistry?: TemplateModelRegistry,
): TemplateModelResolution {
    const registry = modelRegistry || getModelRegistry();
    const parsed = parseProviderModel(templateModel);
    if (!parsed.ok) return { ok: false };

    const resolvedModel = registry.find(parsed.provider, parsed.id);
    const selectable = registry.isSelectable
        ? registry.isSelectable(resolvedModel)
        : registry.hasConfiguredAuth(resolvedModel);
    if (!resolvedModel || !selectable) return { ok: false };

    return { ok: true, provider: resolvedModel.provider, id: resolvedModel.id };
}
