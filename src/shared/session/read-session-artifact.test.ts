import { assertEquals, assertRejects } from "@std/assert";
import { readSessionArtifact } from "./read-session-artifact.ts";
import type { SessionArtifactReference } from "./file-session-store-types.ts";

Deno.test("artifact readers share canonical Markdown loading and reject escaped paths", async () => {
    const root = await Deno.makeTempDir();
    const outside = await Deno.makeTempDir();
    const artifact: SessionArtifactReference = {
        artifactId: "prd-1",
        kind: "prd",
        path: "docs/requirements.md",
        title: "Requirements",
        registeredAt: "2026-09-19T00:00:00.000Z",
        registeredBy: "Ideator",
        sourceSegmentId: "segment-1",
    };
    try {
        await Deno.mkdir(`${root}/docs`);
        await Deno.writeTextFile(`${root}/${artifact.path}`, "# Requirements\n\nShared reader.\n");
        const document = await readSessionArtifact(root, artifact);
        assertEquals(document.markdown, "# Requirements\n\nShared reader.\n");
        assertEquals(document.imageBaseDir, `${await Deno.realPath(root)}/docs`);
        assertEquals(document.kind, "prd");
        await Deno.writeTextFile(`${outside}/private.md`, "outside project");
        await Deno.symlink(`${outside}/private.md`, `${root}/escape.md`);
        await assertRejects(
            () => readSessionArtifact(root, { ...artifact, path: "escape.md" }),
            Error,
            "outside its Project",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
        await Deno.remove(outside, { recursive: true });
    }
});
