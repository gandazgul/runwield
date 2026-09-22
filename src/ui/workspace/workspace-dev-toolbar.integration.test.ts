import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

Deno.test("Astro dev toolbar remains loadable after Workspace navigation modules load", async () => {
    const scratch = await Deno.makeTempDir({ prefix: "workspace-toolbar-test-" });
    const repoRoot = new URL("../../../", import.meta.url);
    const script = `
        import { dev } from "astro";
        import { assertEquals, assertExists } from "@std/assert";
        const server = await dev({
            root: ${JSON.stringify(fileURLToPath(new URL("src/ui/workspace/", repoRoot)))},
            configFile: "astro.config.mjs",
            cacheDir: ${JSON.stringify(`${scratch}/astro`)},
            server: { host: "127.0.0.1", port: 0, open: false },
            vite: { cacheDir: ${JSON.stringify(`${scratch}/vite`)} },
            logLevel: "error",
        });
        try {
            const base = \`http://127.0.0.1:\${server.address.port}\`;
            const readModule = async (path) => {
                const response = await fetch(new URL(path, base));
                const text = await response.text();
                assertEquals(response.status, 200, path + "\\n" + text.slice(0, 1000));
                return text;
            };
            const html = await readModule("/projects/dev-project/sessions/new");
            const toolbarPath = html.match(/src="([^"]*dev-toolbar[/]entrypoint[.]js)"/)?.[1];
            assertExists(toolbarPath, "Workspace must enable the dev toolbar");
            await readModule(toolbarPath);

            // This is the virtual module imported by Workspace's ClientRouter.
            // Fetch its dependencies to finish the late optimization that broke the toolbar.
            const transitions = await readModule("/@id/__x00__astro:transitions/client");
            const dependencies = [...transitions.matchAll(/from "([^"]+)"/g)];
            assertEquals(dependencies.length > 0, true);
            const statuses = [];
            for (const [, path] of dependencies) {
                const response = await fetch(new URL(path, base));
                await response.text();
                statuses.push(response.status);
            }

            const toolbar = await readModule(toolbarPath);
            assertEquals(statuses.every((status) => status === 200), true);
            const apps = [...toolbar.matchAll(/import\\("([^"]+)"\\)/g)];
            assertEquals(apps.length > 0, true, "Exercise the toolbar's lazy app modules");
            for (const [, path] of apps) {
                await readModule(new URL(path, base + toolbarPath).href);
            }
        } finally {
            await server.stop();
        }
    `;
    try {
        const output = await new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", fileURLToPath(new URL("deno.json", repoRoot)), script],
            cwd: scratch,
            env: { ASTRO_TELEMETRY_DISABLED: "1" },
            stdout: "piped",
            stderr: "piped",
            signal: AbortSignal.timeout(180_000),
        }).output();
        const decoder = new TextDecoder();
        assertEquals(output.success, true, decoder.decode(output.stdout) + decoder.decode(output.stderr));
    } finally {
        await Deno.remove(scratch, { recursive: true });
    }
});
