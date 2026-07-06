import { assertEquals } from "@std/assert";

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkJsFiles(dir) {
    for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            yield* walkJsFiles(path);
        } else if (entry.isFile && entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
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
