import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SNIP_FILTERS_DIR } from "../constants.js";
import {
    cleanupRunWieldSnipFiltersForUser,
    getRunWieldSnipFilterInstallStatus,
    getRunWieldSnipPaths,
    installRunWieldSnipFiltersForUser,
} from "./snip-filters.js";

Deno.test("bundled Snip filters are readable from the compile-safe resource directory", async () => {
    const denoTestFilter = await Deno.readTextFile(join(SNIP_FILTERS_DIR, "deno-test.yaml"));

    assertStringIncludes(SNIP_FILTERS_DIR, "src/snip-filters");
    assertStringIncludes(denoTestFilter, "deno test");
});

Deno.test("user Snip filter install and cleanup only manage RunWield-owned files", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "runwield-snip-home-" });
    const bundledDir = await Deno.makeTempDir({ prefix: "runwield-snip-bundled-" });
    try {
        await Deno.writeTextFile(join(bundledDir, "deno-check.yaml"), "name: deno-check\n");
        await Deno.writeTextFile(join(bundledDir, "deno-fmt.yaml"), "name: deno-fmt\n");
        await Deno.writeTextFile(join(bundledDir, "deno-lint.yaml"), "name: deno-lint\n");
        await Deno.writeTextFile(join(bundledDir, "deno-test.yaml"), "name: deno-test\n");

        const paths = getRunWieldSnipPaths({ homeDir });
        await Deno.mkdir(paths.userFiltersDir, { recursive: true });
        await Deno.writeTextFile(join(paths.userFiltersDir, "deno-lint.yaml"), "name: user-deno-lint\n");
        await Deno.writeTextFile(
            join(paths.userFiltersDir, "deno-check.yaml"),
            "# Managed by Harns. Remove with: hns snip-filters cleanup\nname: old-deno-check\n",
        );
        const legacyFiltersDir = join(homeDir, ".config", "snip", "harns", "filters");
        await Deno.mkdir(legacyFiltersDir, { recursive: true });
        for (const fileName of ["deno-fmt.yaml", "deno-lint.yaml", "deno-test.yaml"]) {
            await Deno.writeTextFile(join(legacyFiltersDir, fileName), `name: old-${fileName}\n`);
        }

        const install = await installRunWieldSnipFiltersForUser({ homeDir, bundledDir });
        assertEquals(install.filtersDir, paths.userFiltersDir);
        assertEquals(install.installed.length, 3);
        assertEquals(install.removedLegacy.length, 3);
        assertEquals(install.skipped, [{
            path: join(paths.userFiltersDir, "deno-lint.yaml"),
            reason: "existing non-RunWield filter",
        }]);

        const installedFmt = await Deno.readTextFile(join(paths.userFiltersDir, "deno-fmt.yaml"));
        assertStringIncludes(installedFmt, "Managed by RunWield");
        assertStringIncludes(installedFmt, "name: deno-fmt");
        assertStringIncludes(
            await Deno.readTextFile(join(paths.userFiltersDir, "deno-check.yaml")),
            "Managed by RunWield",
        );
        await assertRejects(() => Deno.stat(legacyFiltersDir), Deno.errors.NotFound);

        const status = await getRunWieldSnipFilterInstallStatus({ homeDir });
        assertEquals(status.installed.length, 3);
        assertEquals(status.conflicts, [join(paths.userFiltersDir, "deno-lint.yaml")]);
        assertEquals(status.missing, []);

        const cleanup = await cleanupRunWieldSnipFiltersForUser({ homeDir });
        assertEquals(cleanup.removed.length, 3);
        assertEquals(cleanup.removedLegacy, []);
        assertEquals(cleanup.skipped, [{
            path: join(paths.userFiltersDir, "deno-lint.yaml"),
            reason: "existing non-RunWield filter",
        }]);
        assertEquals(await Deno.readTextFile(join(paths.userFiltersDir, "deno-lint.yaml")), "name: user-deno-lint\n");
    } finally {
        await Deno.remove(homeDir, { recursive: true }).catch(() => {});
        await Deno.remove(bundledDir, { recursive: true }).catch(() => {});
    }
});
