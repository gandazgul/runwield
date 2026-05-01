import { getModelRegistry } from "../../shared/model-registry.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<any[]>}
 */
export async function getModelCompletions(argumentPrefix) {
    const modelRegistry = getModelRegistry();
    const models = modelRegistry.getAvailable();

    await Promise.resolve();

    return models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => {
            const value = `${m.provider}/${m.id}`;
            return {
                value,
                label: value,
                description: m.name,
            };
        })
        .filter((item) =>
            item.value.startsWith(argumentPrefix) ||
            item.value.split("/")[1].startsWith(argumentPrefix)
        );
}
