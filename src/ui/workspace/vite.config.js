import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tidewave from "tidewave/vite-plugin";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLANNOTATOR_DIR = resolve(ROOT_DIR, "third_party/plannotator");

// Astro owns Workspace dev/build through astro.config.mjs. This Vite config is
// retained only for tools that need the shared alias/plugin setup directly.
export default defineConfig({
    resolve: {
        alias: {
            "@plannotator/ui": resolve(PLANNOTATOR_DIR, "packages/ui"),
            "@plannotator/shared": resolve(PLANNOTATOR_DIR, "packages/shared"),
            "@plannotator/ai": resolve(PLANNOTATOR_DIR, "packages/ai"),
        },
        dedupe: ["react", "react-dom"],
    },
    plugins: [tidewave(), tailwindcss()],
});
