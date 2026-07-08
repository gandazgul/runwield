// @ts-nocheck: local Astro integration mirrors @astrojs/react hooks where Deno/Vite types are not stable.
import viteReact from "@vitejs/plugin-react";

/**
 * Deno-compatible Astro React integration for Workspace.
 *
 * `@astrojs/react`'s default server renderer imports Astro virtual modules via
 * `astro:*` specifiers, which Deno rejects when Astro generates SSR pages. This
 * keeps Astro's React client renderer and Vite React/Fast Refresh support while
 * pointing the server renderer at a local Deno-loadable module.
 */
export default function denoReact() {
    return {
        name: "@astrojs/react",
        hooks: {
            "astro:config:setup": ({ addRenderer, updateConfig, injectScript, command }) => {
                addRenderer({
                    name: "@astrojs/react",
                    clientEntrypoint: "@astrojs/react/client.js",
                    serverEntrypoint: new URL("./react-server.mjs", import.meta.url).href,
                });
                updateConfig({
                    vite: {
                        plugins: [viteReact()],
                        optimizeDeps: {
                            include: ["@astrojs/react/client.js"],
                        },
                    },
                });
                if (command === "dev") {
                    injectScript(
                        "before-hydration",
                        `import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;`,
                    );
                }
            },
        },
    };
}
