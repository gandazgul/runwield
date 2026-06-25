import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import UnoCSS from "unocss/vite";

export default defineConfig({
    plugins: [
        fresh({
            serverEntry: "src/ui/workspace/dev.js",
            clientEntry: "src/ui/workspace/client.js",
            staticDir: ["src/ui/workspace/static"],
        }),
        UnoCSS(),
    ],
});
