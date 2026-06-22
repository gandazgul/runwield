import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureHarnsSnipFilters, getHarnsSnipPaths } from "./snip-filters.js";

Deno.test("ensureHarnsSnipFilters materializes bundled filters and config idempotently", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "harns-snip-home-" });
    const bundledDir = await Deno.makeTempDir({ prefix: "harns-snip-bundled-" });
    try {
        await Deno.writeTextFile(join(bundledDir, "deno-fmt.yaml"), "name: deno-fmt\n");
        await Deno.writeTextFile(join(bundledDir, "deno-lint.yaml"), "name: deno-lint\n");
        await Deno.writeTextFile(join(bundledDir, "deno-test.yaml"), "name: deno-test\n");

        const first = await ensureHarnsSnipFilters({ homeDir, bundledDir });
        const paths = getHarnsSnipPaths({ homeDir });

        assertEquals(first.configPath, paths.configPath);
        assertEquals(first.filtersDir, paths.filtersDir);
        assertEquals(first.written.length, 5);
        assertEquals(await Deno.readTextFile(join(paths.filtersDir, "deno-fmt.yaml")), "name: deno-fmt\n");
        assertEquals(await Deno.readTextFile(join(paths.filtersDir, "deno-lint.yaml")), "name: deno-lint\n");
        assertEquals(await Deno.readTextFile(join(paths.filtersDir, "deno-test.yaml")), "name: deno-test\n");

        const config = await Deno.readTextFile(paths.configPath);
        assertStringIncludes(config, "[filters]");
        assertStringIncludes(config, join(homeDir, ".config", "snip", "filters"));
        assertStringIncludes(config, join(homeDir, ".hns", "snip", "filters"));

        const trustStore = JSON.parse(await Deno.readTextFile(paths.trustStorePath));
        assertEquals(typeof trustStore[join(paths.filtersDir, "deno-fmt.yaml")], "string");
        assertEquals(typeof trustStore[join(paths.filtersDir, "deno-lint.yaml")], "string");
        assertEquals(typeof trustStore[join(paths.filtersDir, "deno-test.yaml")], "string");

        const second = await ensureHarnsSnipFilters({ homeDir, bundledDir });
        assertEquals(second.written, []);
        assertExists(await Deno.stat(paths.configPath));
    } finally {
        await Deno.remove(homeDir, { recursive: true }).catch(() => {});
        await Deno.remove(bundledDir, { recursive: true }).catch(() => {});
    }
});
