/**
 * @param {Record<string, string | undefined>} values
 * @returns {Deno.Env}
 */
export function createTestEnv(values) {
    return {
        get(key) {
            return values[key];
        },
        set(key, value) {
            values[key] = value;
        },
        delete(key) {
            delete values[key];
        },
        has(key) {
            return values[key] !== undefined;
        },
        toObject() {
            /** @type {Record<string, string>} */
            const result = {};
            for (const [key, value] of Object.entries(values)) {
                if (value !== undefined) result[key] = value;
            }
            return result;
        },
    };
}

/**
 * @param {Request} request
 * @returns {import("astro").APIContext}
 */
export function createTestApiContext(request) {
    return /** @type {import("astro").APIContext} */ ({ request });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
export async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        const decoder = new TextDecoder();
        throw new Error(decoder.decode(output.stderr) || decoder.decode(output.stdout));
    }
    return new TextDecoder().decode(output.stdout);
}

/** @param {Response} response */
export async function readJsonResponse(response) {
    return await response.json();
}

/** @param {string} url @param {unknown} body @param {string} [bearer] */
export function jsonRequest(url, body, bearer) {
    /** @type {Record<string, string>} */
    const headers = { "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}
