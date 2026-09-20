import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { makeValidationProjectRoot } from "../../shared/workflow/validation-test-helpers.js";

Deno.test("Astro dev serves local and owner Plan Boards with canonical Plan data", async () => {
    const projectRoot = await makeValidationProjectRoot("dev-import-regression", {
        status: "draft",
        summary: "Canonical development import fixture",
    });
    const scratch = await Deno.makeTempDir({ prefix: "workspace-astro-dev-test-" });
    const repoRoot = new URL("../../../", import.meta.url);
    const script = `
        import { dev } from ${JSON.stringify(new URL("node_modules/astro/dist/core/index.js", repoRoot).href)};
        import { assertEquals, assertStringIncludes } from "@std/assert";
        const server = await dev({
            root: ${JSON.stringify(fileURLToPath(new URL("src/ui/workspace/", repoRoot)))},
            configFile: "astro.config.mjs",
            cacheDir: ${JSON.stringify(`${scratch}/astro`)},
            server: { host: "127.0.0.1", port: 0, open: false },
            vite: { cacheDir: ${JSON.stringify(`${scratch}/vite`)} },
            logLevel: "error",
        });
        try {
            for (const route of ["/", "/projects/dev-project/plans"]) {
                const response = await fetch(\`http://127.0.0.1:\${server.address.port}\${route}\`);
                const html = await response.text();
                assertEquals(response.status, 200, route + "\\n" + html.slice(0, 3000));
                assertStringIncludes(html, "dev-import-regression", route);
            }
        } finally {
            await server.stop();
        }
    `;
    try {
        const output = await new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", fileURLToPath(new URL("deno.json", repoRoot)), script],
            cwd: projectRoot,
            env: { ASTRO_TELEMETRY_DISABLED: "1" },
            stdout: "piped",
            stderr: "piped",
            signal: AbortSignal.timeout(120_000),
        }).output();
        const decoder = new TextDecoder();
        assertEquals(output.success, true, decoder.decode(output.stdout) + decoder.decode(output.stderr));
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(scratch, { recursive: true });
    }
});
