/**
 * @module ui/tui/testing/isolated-environment
 * Isolated filesystem fixture setup for Golden TUI scenarios.
 */

import { join } from "@std/path";

export const GOLDEN_FAUX_PROVIDER = "golden";
export const GOLDEN_FAUX_MODEL = "faux";
export const GOLDEN_FAUX_API = "golden-faux";

/**
 * Install the stable external Mnemosyne boundary used by composed scenarios.
 * The scenarios exercise RunWield's real Work Record machinery, but must not
 * contend for or mutate the developer's Mnemosyne database when Golden files run
 * concurrently.
 *
 * @param {string} root
 * @returns {Promise<string>}
 */
async function writeGoldenMnemosyneFixture(root) {
    const binDir = join(root, "bin");
    const executable = join(binDir, "mnemosyne");
    await Deno.mkdir(binDir, { recursive: true });
    await Deno.writeTextFile(
        executable,
        [
            "#!/bin/sh",
            'if [ "$1" = "update" ] && [ "$2" = "--help" ]; then',
            "  echo 'Usage: mnemosyne update <id> --replace-tags'",
            'elif [ "$1" = "list" ]; then',
            "  echo 'No documents'",
            'elif [ "$1" = "search" ]; then',
            "  echo '{\"results\":[]}'",
            'elif [ "$1" = "export" ]; then',
            "  shift",
            '  while [ "$#" -gt 0 ]; do',
            '    if [ "$1" = "--output" ]; then',
            "      shift",
            '      mkdir -p "$(dirname "$1")"',
            '      printf \'%s\\n\' \'{"type":"mnemosyne-export"}\' > "$1"',
            "      break",
            "    fi",
            "    shift",
            "  done",
            "fi",
            "exit 0",
            "",
        ].join("\n"),
    );
    await Deno.chmod(executable, 0o755);
    const githubExecutable = join(binDir, "gh");
    await Deno.writeTextFile(
        githubExecutable,
        ["#!/bin/sh", "echo 'golden fixture: gh unavailable' >&2", "exit 1", ""].join("\n"),
    );
    await Deno.chmod(githubExecutable, 0o755);
    return binDir;
}

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @typedef {{ id: string, name?: string, reasoning?: boolean }} GoldenModelDefinition */

/**
 * @param {string} runwieldDir
 * @param {{ api?: string, models?: GoldenModelDefinition[] }} [options]
 */
export async function writeGoldenModelConfig(runwieldDir, options = {}) {
    const models = options.models || [{ id: GOLDEN_FAUX_MODEL, name: "Golden Faux Model" }];
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
                        models: models.map((model) => ({
                            id: model.id,
                            name: model.name || model.id,
                            api: options.api || GOLDEN_FAUX_API,
                            reasoning: model.reasoning || false,
                            input: ["text", "image"],
                            contextWindow: 128000,
                            maxTokens: 4096,
                        })),
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
 * @property {string} remoteRoot
 * @property {string} runwieldDir
 * @property {Record<string, string>} env
 * @property {() => Promise<void>} cleanup
 */

/**
 * @param {{ keep?: boolean, initDone?: boolean, initArtifact?: boolean }} [options]
 * @returns {Promise<GoldenIsolatedEnvironment>}
 */
export async function createGoldenIsolatedEnvironment(options = {}) {
    const root = await Deno.makeTempDir({ prefix: "runwield-golden-tui-" });
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const remoteRoot = join(root, "remote.git");
    const runwieldDir = join(home, ".wld");
    const fixtureBinDir = await writeGoldenMnemosyneFixture(root);
    await Deno.mkdir(projectRoot, { recursive: true });
    await Deno.mkdir(runwieldDir, { recursive: true });
    await Deno.writeTextFile(
        join(projectRoot, "README.md"),
        "# Golden TUI Fixture\n\nRouting uses the Router to select Guide.\n",
    );
    const initDone = options.initDone !== false;
    const initArtifact = options.initArtifact ?? initDone;
    if (initArtifact) {
        await Deno.mkdir(join(projectRoot, "docs"), { recursive: true });
        await Deno.writeTextFile(
            join(projectRoot, "docs", "domain-language.md"),
            "# Domain Language\n\n## Golden Fixture\n\nCurrent Golden project terminology.\n",
        );
    }
    await new Deno.Command("git", { args: ["init", "-b", "main"], cwd: projectRoot, stdout: "null", stderr: "null" })
        .output();
    await new Deno.Command("git", { args: ["config", "user.email", "golden@example.test"], cwd: projectRoot }).output();
    await new Deno.Command("git", { args: ["config", "user.name", "Golden TUI"], cwd: projectRoot }).output();
    await new Deno.Command("git", { args: ["add", "-A"], cwd: projectRoot }).output();
    await new Deno.Command("git", {
        args: ["commit", "-m", "Initial fixture"],
        cwd: projectRoot,
        stdout: "null",
        stderr: "null",
    }).output();
    await new Deno.Command("git", {
        args: ["init", "--bare", remoteRoot],
        stdout: "null",
        stderr: "null",
    }).output();
    await new Deno.Command("git", { args: ["remote", "add", "origin", remoteRoot], cwd: projectRoot }).output();
    await new Deno.Command("git", {
        args: ["push", "-u", "origin", "main"],
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
                    initOffered: initDone,
                    initDone,
                    offeredAt: initDone ? new Date(0).toISOString() : null,
                    doneAt: initDone ? new Date(0).toISOString() : null,
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
        JSON.stringify({
            theme: "default",
            defaultProvider: GOLDEN_FAUX_PROVIDER,
            defaultModel: GOLDEN_FAUX_MODEL,
            // Composed scenarios drive the production TUI composition, whose Runtime
            // adapter wires the real notifier. Without this the suite fires actual
            // desktop notifications on the developer's machine.
            notifications: { enabled: false },
        }),
    );
    const env = {
        HOME: home,
        RUNWIELD_HOME: runwieldDir,
        PATH: `${fixtureBinDir}:${Deno.env.get("PATH") || ""}`,
        NO_COLOR: "1",
        WLD_GOLDEN_TUI: "1",
    };
    return {
        root,
        home,
        projectRoot,
        remoteRoot,
        runwieldDir,
        env,
        async cleanup() {
            if (options.keep) return;
            await removeTempDir(root);
        },
    };
}
