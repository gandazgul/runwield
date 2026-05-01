/**
 * @module shared/model-validation
 * Shared strict model input parsing/validation helpers.
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
