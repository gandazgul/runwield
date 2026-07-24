import { assert, assertEquals } from "@std/assert";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";

const ADR_DIR = "docs/adr";
const ALLOWED_ADR_STATUSES = new Set(["proposed", "accepted", "deprecated", "superseded"]);

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkMarkdownFiles(dir) {
    for await (const entry of Deno.readDir(dir)) {
        const path = join(dir, entry.name);
        if (entry.isDirectory) {
            yield* walkMarkdownFiles(path);
            continue;
        }
        if (entry.isFile && entry.name.endsWith(".md")) yield path;
    }
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function frontMatterText(markdown) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    return match?.[1] || "";
}

Deno.test("ADR artifacts use required machine-readable status front matter", async () => {
    const checkedPaths = [];
    for await (const path of walkMarkdownFiles(ADR_DIR)) {
        checkedPaths.push(path);
        const markdown = await Deno.readTextFile(path);
        assert(hasFrontMatter(markdown), `${path} must start with YAML front matter`);

        const statusFields = frontMatterText(markdown).split("\n").filter((line) => /^status\s*:/.test(line));
        assertEquals(statusFields.length, 1, `${path} must define exactly one status field`);

        const { attrs, body } = extractYaml(markdown);
        assertEquals(typeof attrs.status, "string", `${path} status must be a string`);
        assert(
            ALLOWED_ADR_STATUSES.has(attrs.status),
            `${path} status must be one of ${Array.from(ALLOWED_ADR_STATUSES).join(", ")}`,
        );
        assert(!/^## Status\s*$/m.test(body), `${path} must not use a prose ## Status section`);
    }

    assert(checkedPaths.length > 0, "expected at least one ADR artifact");
});
