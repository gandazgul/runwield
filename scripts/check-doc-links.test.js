import { assertEquals } from "@std/assert";
import { extractRelativeLinks, findBrokenLinks, headingSlug, headingSlugs } from "./check-doc-links.js";

/**
 * @param {Record<string, string>} files
 */
function fakeRepo(files) {
    return {
        /** @param {string} path */
        readTextFile: (path) => {
            if (!(path in files)) throw new Deno.errors.NotFound(path);
            return Promise.resolve(files[path]);
        },
        /** @param {string} path */
        pathExists: (path) => Promise.resolve(path in files),
    };
}

Deno.test("extractRelativeLinks ignores absolute, anchor-only, and fenced links", () => {
    const markdown = [
        "[relative](docs/thing.md)",
        "[external](https://example.com/x.md)",
        "[anchor](#section)",
        "[mail](mailto:a@b.c)",
        "```",
        "[fenced](docs/nope.md)",
        "```",
    ].join("\n");

    assertEquals(extractRelativeLinks(markdown), [{ line: 1, target: "docs/thing.md" }]);
});

Deno.test("headingSlug matches GitHub-style anchors", () => {
    assertEquals(headingSlug("## Plan Workflow Model"), "-plan-workflow-model");
    assertEquals(headingSlug("Execution, Validation, and Delivery Model"), "execution-validation-and-delivery-model");
    assertEquals(headingSlug("`code` and *emphasis*"), "code-and-emphasis");
});

Deno.test("headingSlugs skips fenced code and disambiguates duplicates", () => {
    const slugs = headingSlugs(["# Title", "```", "# Not A Heading", "```", "## Title"].join("\n"));
    assertEquals([...slugs], ["title", "title-1"]);
});

Deno.test("findBrokenLinks resolves relative to the linking file, not the repo root", async () => {
    // The exact defect this ratchet exists for: docs/architecture.md linking
    // "docs/entity-model.md" resolves to docs/docs/entity-model.md.
    const repo = fakeRepo({
        "docs/architecture.md": "[model](docs/entity-model.md)",
        "docs/entity-model.md": "# Model",
    });
    const broken = await findBrokenLinks(["docs/architecture.md"], repo.readTextFile, repo.pathExists);

    assertEquals(broken.length, 1);
    assertEquals(broken[0].reason, "no such file: docs/docs/entity-model.md");
});

Deno.test("findBrokenLinks accepts a correctly resolved sibling link", async () => {
    const repo = fakeRepo({
        "docs/architecture.md": "[model](entity-model.md)",
        "docs/entity-model.md": "# Model",
    });
    assertEquals(await findBrokenLinks(["docs/architecture.md"], repo.readTextFile, repo.pathExists), []);
});

Deno.test("findBrokenLinks rejects a fragment with no matching heading", async () => {
    const repo = fakeRepo({
        "docs/a.md": "[gone](b.md#removed-section)",
        "docs/b.md": "# Present Section",
    });
    const broken = await findBrokenLinks(["docs/a.md"], repo.readTextFile, repo.pathExists);

    assertEquals(broken.length, 1);
    assertEquals(broken[0].reason, 'no heading "#removed-section" in docs/b.md');
});

Deno.test("findBrokenLinks accepts a fragment that matches a heading", async () => {
    const repo = fakeRepo({
        "docs/a.md": "[there](b.md#present-section)",
        "docs/b.md": "# Present Section",
    });
    assertEquals(await findBrokenLinks(["docs/a.md"], repo.readTextFile, repo.pathExists), []);
});

Deno.test("findBrokenLinks flags links that escape the repository", async () => {
    const repo = fakeRepo({ "docs/a.md": "[out](../../elsewhere.md)" });
    const broken = await findBrokenLinks(["docs/a.md"], repo.readTextFile, repo.pathExists);

    assertEquals(broken.length, 1);
    assertEquals(broken[0].reason, "resolves outside the repository");
});
