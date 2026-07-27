/**
 * @module ui/tui/testing/isolated-environment
 * Isolated filesystem fixture setup for Golden TUI scenarios.
 */

import { join } from "@std/path";

export const GOLDEN_FAUX_PROVIDER = "golden";
export const GOLDEN_FAUX_MODEL = "faux";
export const GOLDEN_FAUX_API = "golden-faux";

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} runwieldDir
 * @param {{ api?: string }} [options]
 */
export async function writeGoldenModelConfig(runwieldDir, options = {}) {
    await Deno.mkdir(runwieldDir, { recursive: true });
    await Deno.writeTextFile(
        join(runwieldDir, "models.json"),
        JSON.stringify(
            {
                providers: {
                    [GOLDEN_FAUX_PROVIDER]: {
                        name: "Golden Faux Provider",
                        baseUrl: "http://127.0.0.1:0",
                        apiKey: "golden-test-key",
                        api: options.api || GOLDEN_FAUX_API,
                        models: [
                            {
                                id: GOLDEN_FAUX_MODEL,
                                name: "Golden Faux Model",
                                api: options.api || GOLDEN_FAUX_API,
                                input: ["text", "image"],
                                contextWindow: 128000,
                                maxTokens: 4096,
                            },
                        ],
                    },
                },
            },
            null,
            2,
        ),
    );
}

/** @param {number} ms */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} path */
async function removeTempDir(path) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await Deno.remove(path, { recursive: true });
            return;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            if (attempt === 4) throw error;
            await delay(20 * (attempt + 1));
        }
    }
}

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
    await Deno.writeTextFile(
        join(projectRoot, "README.md"),
        "# Golden TUI Fixture\n\nRouting uses the Router to select Guide.\n",
    );
    await new Deno.Command("git", { args: ["init"], cwd: projectRoot, stdout: "null", stderr: "null" }).output();
    await new Deno.Command("git", { args: ["config", "user.email", "golden@example.test"], cwd: projectRoot }).output();
    await new Deno.Command("git", { args: ["config", "user.name", "Golden TUI"], cwd: projectRoot }).output();
    await new Deno.Command("git", { args: ["add", "README.md"], cwd: projectRoot }).output();
    await new Deno.Command("git", {
        args: ["commit", "-m", "Initial fixture"],
        cwd: projectRoot,
        stdout: "null",
        stderr: "null",
    }).output();
    await writeGoldenModelConfig(runwieldDir);
    const canonicalProjectRoot = await Deno.realPath(projectRoot);
    const projectHash = await sha256(canonicalProjectRoot);
    await Deno.writeTextFile(
        join(runwieldDir, "init-state.json"),
        JSON.stringify(
            {
                [projectHash]: {
                    path: canonicalProjectRoot,
                    initOffered: true,
                    initDone: true,
                    offeredAt: new Date(0).toISOString(),
                    doneAt: new Date(0).toISOString(),
                    snipMissingWarningCount: 3,
                    snipMissingWarningLastShownAt: new Date(0).toISOString(),
                },
            },
            null,
            2,
        ) + "\n",
    );
    await Deno.mkdir(join(runwieldDir, "sessions"), { recursive: true });
    await Deno.mkdir(join(runwieldDir, "worktrees"), { recursive: true });
    await Deno.mkdir(join(runwieldDir, "registry"), { recursive: true });
    await Deno.writeTextFile(
        join(runwieldDir, "settings.json"),
        JSON.stringify({ theme: "default", defaultProvider: GOLDEN_FAUX_PROVIDER, defaultModel: GOLDEN_FAUX_MODEL }),
    );
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
            await removeTempDir(root);
        },
    };
}
