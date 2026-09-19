import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { renderPublicDocument, stagePublicDocs } from "./public-docs.ts";

const RELEASE = {
    version: "v1.2.3",
    sourceRef: "v1.2.3",
    releaseUrl: "https://github.com/gandazgul/runwield/releases/tag/v1.2.3",
};

Deno.test("public docs render their source heading and release-pinned links", () => {
    const rendered = renderPublicDocument(
        "# Example\n\nRead [usage](usage.md#commands), [the PRD](prd/runwield.md), [reference guide][guide], and [Pi](https://pi.dev).\n\n![Logo](../brand/logo.svg)\n\n[guide]: usage.md#commands\n",
        "quickstart.md",
        RELEASE,
    );
    assertStringIncludes(rendered, 'title: "Example"');
    assertStringIncludes(rendered, "[usage](/usage/#commands)");
    assertStringIncludes(rendered, "[guide]: /usage/#commands");
    assertStringIncludes(rendered, "/blob/v1.2.3/docs/prd/runwield.md");
    assertStringIncludes(rendered, "[Pi](https://pi.dev)");
    assertStringIncludes(
        rendered,
        "/docs-assets/brand/logo.svg",
    );
    assertEquals(rendered.includes("# Example"), false);
});

Deno.test("public docs reject source without a page title", () => {
    assertRejects(
        async () =>
            await Promise.resolve(
                renderPublicDocument("No heading", "quickstart.md", RELEASE),
            ),
        Error,
        "needs one H1",
    );
});

Deno.test("public docs stage only the publication manifest", async () => {
    const root = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${root}/docs-site`, { recursive: true });
        await Deno.mkdir(`${root}/docs`, { recursive: true });
        await Deno.writeTextFile(
            `${root}/docs-site/release.json`,
            JSON.stringify(RELEASE),
        );
        for (
            const name of [
                "index",
                "quickstart",
                "workspace",
                "workspace-container",
                "usage",
                "workflows",
                "collaboration",
                "sessions",
                "providers",
                "customization",
                "troubleshooting",
                "settings",
                "themes",
                "mcp",
                "plan-lifecycle",
                "validation-authority",
                "contributing",
            ]
        ) {
            await Deno.writeTextFile(
                `${root}/docs/${name}.md`,
                `# ${name}\n\nMARKER-${name}\n`,
            );
        }
        await Deno.mkdir(`${root}/brand`);
        await Deno.writeTextFile(`${root}/brand/logo.svg`, "<svg></svg>");
        await Deno.writeTextFile(
            `${root}/docs/quickstart.md`,
            "# quickstart\n\nMARKER-quickstart\n\n![Logo](../brand/logo.svg)\n",
        );
        await Deno.mkdir(`${root}/docs/prd`);
        await Deno.writeTextFile(
            `${root}/docs/prd/secret.md`,
            "# INTERNAL-PRD-MARKER\n",
        );
        const output = `${root}/generated`;
        await stagePublicDocs(root, output);
        const paths = Array.from(Deno.readDirSync(output)).map((entry) => entry.name).sort();
        assertEquals(paths.includes("prd"), false);
        assertEquals(paths.includes("index.md"), true);
        assertStringIncludes(
            await Deno.readTextFile(`${output}/quickstart.md`),
            "MARKER-quickstart",
        );
        assertEquals(
            await Deno.readTextFile(`${root}/docs-site/public/docs-assets/brand/logo.svg`),
            "<svg></svg>",
        );
        await Deno.writeTextFile(
            `${root}/docs/quickstart.md`,
            "# quickstart\n\n[missing](does-not-exist.md)\n",
        );
        await assertRejects(
            () => stagePublicDocs(root, output),
            Error,
            "missing local target",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
