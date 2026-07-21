import { assertEquals } from "@std/assert";
import {
    getOpaqueWorkspaceAssetName,
    getServerEntryImportPaths,
    normalizeDenoAdapterShimImport,
} from "./build-workspace-runtime.js";

Deno.test("getOpaqueWorkspaceAssetName hides executable browser modules from compile graph tracing", () => {
    assertEquals(getOpaqueWorkspaceAssetName("client.js"), "client.js.asset");
    assertEquals(getOpaqueWorkspaceAssetName("worker.mjs"), "worker.mjs.asset");
    assertEquals(getOpaqueWorkspaceAssetName("styles.css"), "styles.css");
    assertEquals(getOpaqueWorkspaceAssetName("sprite.png"), "sprite.png");
});

Deno.test("getServerEntryImportPaths ignores JSDoc type imports", () => {
    const source = `
import { route } from "./chunks/route.mjs";
import "./chunks/setup.mjs";
const page = () => import("./chunks/page.mjs");
/** @type {import("./types.js").GeneratedType} */
const typed = route;
`;

    assertEquals(getServerEntryImportPaths(source, "dist/workspace/server"), [
        "dist/workspace/server/chunks/route.mjs",
        "dist/workspace/server/chunks/setup.mjs",
        "dist/workspace/server/chunks/page.mjs",
    ]);
});

Deno.test("normalizeDenoAdapterShimImport replaces entrypoint adapter shims", () => {
    const source = 'import { fromFileUrl, serveFile } from "@deno/astro-adapter/__deno_imports.ts";\n';

    assertEquals(
        normalizeDenoAdapterShimImport(source),
        'import { serveFile } from "jsr:@std/http@1.0/file-server";\nimport { fromFileUrl } from "jsr:@std/path@1.0";\n',
    );
});
