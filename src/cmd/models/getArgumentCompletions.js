import { getModelRegistry } from "../../shared/models/model-registry.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getModelCompletions(argumentPrefix) {
    const modelRegistry = getModelRegistry();
    const models = modelRegistry.getAvailable();

    await Promise.resolve();

    const lowerPrefix = argumentPrefix.toLowerCase();
    return models
        .sort((modelA, modelB) => modelA.id.localeCompare(modelB.id))
        .map((model) => {
            const value = `${model.provider}/${model.id}`;
            return {
                value,
                label: value,
                description: model.name,
                provider: model.provider,
                id: model.id,
            };
        })
        .filter((item) =>
            item.value.toLowerCase().startsWith(lowerPrefix) ||
            item.id.toLowerCase().startsWith(lowerPrefix) ||
            item.provider.toLowerCase().startsWith(lowerPrefix) ||
            // Handle OpenRouter-style IDs with slashes (e.g., google/gemini-flash)
            item.id.toLowerCase().split("/").some((part) => part.startsWith(lowerPrefix))
        );
}
