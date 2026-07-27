/**
 * @module ui/tui/testing/isolated-environment
 * Isolated filesystem fixture setup for Golden TUI scenarios.
 */

import { join } from "@std/path";

/**
 * @typedef {Object} GoldenIsolatedEnvironment
 * @property {string} root
 * @property {string} home
 * @property {string} projectRoot
 * @property {string} runwieldDir
 * @property {Record<string, string>} env
 * @property {() => Promise<void>} cleanup
 */

/**
 * @param {{ keep?: boolean }} [options]
 * @returns {Promise<GoldenIsolatedEnvironment>}
 */
export async function createGoldenIsolatedEnvironment(options = {}) {
    const root = await Deno.makeTempDir({ prefix: "runwield-golden-tui-" });
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const runwieldDir = join(home, ".wld");
    await Deno.mkdir(projectRoot, { recursive: true });
    await Deno.mkdir(runwieldDir, { recursive: true });
    await Deno.writeTextFile(join(projectRoot, "README.md"), "# Golden TUI Fixture\n");
    const env = {
        HOME: home,
        RUNWIELD_HOME: runwieldDir,
        NO_COLOR: "1",
        WLD_GOLDEN_TUI: "1",
    };
    return {
        root,
        home,
        projectRoot,
        runwieldDir,
        env,
        async cleanup() {
            if (options.keep) return;
            await Deno.remove(root, { recursive: true }).catch(() => {});
        },
    };
}
