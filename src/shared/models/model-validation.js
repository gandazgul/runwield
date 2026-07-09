/**
 * @module shared/model-validation
 * Shared strict model input parsing/validation helpers.
 */

import { getModelRegistry } from "./model-registry.js";

/**
 * @typedef {Object} TemplateModelRegistry
 * @property {(provider: string, model: string) => unknown} find
 * @property {(model: any) => boolean} hasConfiguredAuth
 */

/**
 * Parse a strict model reference in `provider/id` format.
 *
 * @param {string} value
 * @returns {{ ok: true, provider: string, id: string } | { ok: false }}
 */
export function parseProviderModel(value) {
    const text = value.trim();
    const slashIndex = text.indexOf("/");

    if (slashIndex <= 0 || slashIndex === text.length - 1) {
        return { ok: false };
    }

    const provider = text.slice(0, slashIndex).trim();
    const id = text.slice(slashIndex + 1).trim();

    if (!provider || !id) {
        return { ok: false };
    }

    return { ok: true, provider, id };
}

/**
 * Resolve and validate a model declared by a prompt template or workflow.
 * Requires strict `provider/id` format and configured authentication.
 *
 * @param {string} templateModel
 * @param {TemplateModelRegistry} [modelRegistry]
 * @returns {{ ok: true, provider: string, id: string } | { ok: false }}
 */
export function resolveTemplateModel(templateModel, modelRegistry) {
    const registry = /** @type {TemplateModelRegistry} */ (modelRegistry || getModelRegistry());
    const parsed = parseProviderModel(templateModel);
    if (!parsed.ok) return { ok: false };

    const resolvedModel = registry.find(parsed.provider, parsed.id);
    if (!resolvedModel || !registry.hasConfiguredAuth(resolvedModel)) {
        return { ok: false };
    }

    const configuredModel = /** @type {{ provider: string, id: string }} */ (resolvedModel);
    return { ok: true, provider: configuredModel.provider, id: configuredModel.id };
}
