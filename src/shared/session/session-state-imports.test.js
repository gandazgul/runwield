import { assertEquals } from "@std/assert";

/**
 * @param {string} dir
 * @param {boolean} [includeTests]
 * @returns {AsyncGenerator<string>}
 */
async function* walkJsFiles(dir, includeTests = false) {
    for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            yield* walkJsFiles(path, includeTests);
        } else if (entry.isFile && entry.name.endsWith(".js") && (includeTests || !entry.name.endsWith(".test.js"))) {
            yield path;
        }
    }
}

Deno.test("production code does not import removed mutable session-state singleton", async () => {
    /** @type {string[]} */
    const matches = [];
    for await (const path of walkJsFiles("src")) {
        const source = await Deno.readTextFile(path);
        if (source.includes("session-state.js")) matches.push(path);
    }

    assertEquals(matches, []);
});

Deno.test("shared core and tools never import UI or ACP adapters", async () => {
    /** @type {string[]} */
    const matches = [];
    for (const root of ["src/shared", "src/tools"]) {
        for await (const path of walkJsFiles(root, true)) {
            const source = await Deno.readTextFile(path);
            if (/from\s+["'][^"']*(?:\/ui\/|\/acp\/)/.test(source)) matches.push(path);
            if (/import\(["'][^"']*(?:\/ui\/|\/acp\/)/.test(source)) matches.push(path);
        }
    }

    assertEquals(Array.from(new Set(matches)).sort(), []);
});
