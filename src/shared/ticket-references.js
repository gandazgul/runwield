/**
 * @module shared/ticket-references
 * Provider-neutral Ticket Reference normalization and presentation helpers.
 */

/**
 * Provider-neutral relation to a user-identified external demand Ticket.
 *
 * @typedef {Object<string, unknown>} TicketReference
 * @property {string} url - Required user-supplied Ticket URL. Surrounding whitespace is trimmed.
 */

/** @param {unknown} value */
function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isYamlSafeTicketReferenceValue(value) {
    if (value === null) return true;
    if (["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(isYamlSafeTicketReferenceValue);
    if (isPlainObject(value)) {
        return Object.entries(/** @type {Record<string, unknown>} */ (value)).every(([key, child]) =>
            typeof key === "string" && key.trim() && isYamlSafeTicketReferenceValue(child)
        );
    }
    return false;
}

/**
 * @param {unknown} value
 * @returns {TicketReference[]|undefined}
 */
export function normalizeTicketReferences(value) {
    if (!Array.isArray(value)) return undefined;
    /** @type {TicketReference[]} */
    const normalized = [];
    for (const item of value) {
        if (!isPlainObject(item)) continue;
        const source = /** @type {Record<string, unknown>} */ (item);
        if (typeof source.url !== "string") continue;
        const url = source.url.trim();
        if (!url) continue;
        /** @type {TicketReference} */
        const reference = { url };
        for (const [key, child] of Object.entries(source)) {
            if (key === "url" || child === undefined) continue;
            if (!isYamlSafeTicketReferenceValue(child)) continue;
            reference[key] = child;
        }
        normalized.push(reference);
    }
    return normalized.length ? normalized : undefined;
}

/**
 * @param {unknown} value
 * @returns {TicketReference[]}
 */
export function normalizeTicketReferencesList(value) {
    return normalizeTicketReferences(value) || [];
}

/**
 * @param {unknown[]} collections
 * @returns {TicketReference[]|undefined}
 */
export function dedupeTicketReferencesByUrl(...collections) {
    /** @type {TicketReference[]} */
    const result = [];
    const seen = new Set();
    for (const collection of collections) {
        for (const reference of normalizeTicketReferencesList(collection)) {
            if (seen.has(reference.url)) continue;
            seen.add(reference.url);
            result.push(reference);
        }
    }
    return result.length ? result : undefined;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function safeHttpTicketReferenceUrl(value) {
    if (typeof value !== "string") return "";
    const url = value.trim();
    if (!url) return "";
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "";
    } catch {
        return "";
    }
}
