import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
    getOpaqueWorkspaceAssetName,
    getServerEntryImportPaths,
    normalizeCompiledNodeChildProcessImports,
    normalizeDenoAdapterShimImport,
    waitForStableWorkspaceClientAssets,
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

Deno.test("waitForStableWorkspaceClientAssets waits for delayed generated files", async () => {
    const root = await Deno.makeTempDir({ prefix: "wld-workspace-client-assets-" });
    try {
        await Deno.writeTextFile(join(root, "first.css"), "a{}");
        const delayedWrite = new Promise((resolve, reject) => {
            setTimeout(() => Deno.writeTextFile(join(root, "second.css"), "b{}").then(resolve, reject), 20);
        });
        await waitForStableWorkspaceClientAssets(root, { intervalMs: 50, timeoutMs: 1000 });
        await delayedWrite;

        assertEquals(await Deno.readTextFile(join(root, "second.css")), "b{}");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("normalizeCompiledNodeChildProcessImports replaces dynamic child_process requires", () => {
    const source =
        'var a=Ut("node:child_process");import{spawn as sp,spawnSync as ss}from"node:child_process";var b=Ut("node:child_process");';

    assertEquals(
        normalizeCompiledNodeChildProcessImports(source),
        'var a=({exec:__rwNodeChildProcessExec,spawn:sp,spawnSync:ss});import{exec as __rwNodeChildProcessExec,spawn as sp,spawnSync as ss}from"node:child_process";var b=({exec:__rwNodeChildProcessExec,spawn:sp,spawnSync:ss});',
    );
});
