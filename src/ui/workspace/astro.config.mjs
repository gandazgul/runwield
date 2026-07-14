// @ts-nocheck: Astro/Vite plugin type packages resolve to multiple Vite versions under Deno npm nodeModulesDir.
// Polyfill for Astro's Vite CJS evaluator in Deno, following the local Goaly Astro app pattern.
globalThis.exports = globalThis.exports || {};
globalThis.module = globalThis.module || { exports: globalThis.exports };

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, passthroughImageService } from "astro/config";
import deno from "@deno/astro-adapter";
import react from "./integrations/deno-react.mjs";
import tailwindcss from "@tailwindcss/vite";
import tidewave from "tidewave/vite-plugin";

const WORKSPACE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(WORKSPACE_DIR, "../../..");
const PLANNOTATOR_DIR = resolve(ROOT_DIR, "third_party/plannotator");

export default defineConfig({
    root: WORKSPACE_DIR,
    srcDir: WORKSPACE_DIR,
    publicDir: resolve(WORKSPACE_DIR, "static"),
    outDir: resolve(ROOT_DIR, "dist/workspace"),
    output: "server",
    server: {
        host: "127.0.0.1",
        port: 5173,
    },
    adapter: deno({
        start: false,
    }),
    integrations: [react()],
    image: {
        service: passthroughImageService(),
    },
    security: {
        checkOrigin: false,
    },
    vite: {
        plugins: [tidewave(), tailwindcss()],
        build: {
            rollupOptions: {
                external: [/^@std\//],
            },
        },
        ssr: {
            external: [/^@std\//],
        },
        optimizeDeps: {
            exclude: ["@std/front-matter", "@std/jsonc", "@std/path"],
            esbuildOptions: {
                define: { "process.env.NODE_ENV": '"development"' },
            },
            include: [
                "@pierre/diffs",
                "@pierre/diffs/react",
                "@plannotator/web-highlighter",
                "@radix-ui/react-context-menu",
                "@radix-ui/react-dialog",
                "@radix-ui/react-dropdown-menu",
                "@radix-ui/react-popover",
                "@radix-ui/react-slot",
                "@radix-ui/react-tooltip",
                "@tanstack/react-table",
                "@viz-js/viz",
                "class-variance-authority",
                "clsx",
                "dompurify",
                "dockview-react",
                "highlight.js",
                "lucide-react",
                "katex",
                "marked",
                "mermaid",
                "perfect-freehand",
                "tailwind-merge",
                "unique-username-generator",
            ],
        },
        resolve: {
            alias: {
                "@pierre/diffs/worker/worker.js?worker&inline": resolve(
                    WORKSPACE_DIR,
                    "react/pierre-diffs-worker-shim.js",
                ),
                "@pierre/diffs/worker/worker.js": resolve(WORKSPACE_DIR, "react/pierre-diffs-worker-shim.js"),
                "@plannotator/markdown-editor/themes/plannotator.css": resolve(
                    WORKSPACE_DIR,
                    "react/markdown-editor-shim.css",
                ),
                "@plannotator/markdown-editor": resolve(WORKSPACE_DIR, "react/markdown-editor-shim.tsx"),
                "@plannotator/ui": resolve(PLANNOTATOR_DIR, "packages/ui"),
                "@plannotator/shared": resolve(PLANNOTATOR_DIR, "packages/shared"),
                "@plannotator/ai": resolve(PLANNOTATOR_DIR, "packages/ai"),
            },
            dedupe: ["react", "react-dom"],
        },
    },
});
