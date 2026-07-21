import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    buildPlanServerRuntime,
    findProhibitedRuntimeFiles,
    listRuntimeAssetDestinations,
    listRuntimeFiles,
    REQUIRED_WORKSPACE_RUNTIME_FILES,
} from "./build-plan-server-runtime.js";

/** @returns {Promise<string>} */
async function makeTempRoot() {
    return await Deno.makeTempDir({ prefix: "runwield-plan-server-runtime-" });
}

/**
 * @param {string} path
 * @param {string} content
 */
async function writeFile(path, content = "fixture") {
    await Deno.mkdir(join(path, ".."), { recursive: true }).catch(() => {});
    await Deno.writeTextFile(path, content);
}

/** @param {string} root */
const AGENT_DEFINITION_ASSETS = [
    "src/agent-definitions/architect.md",
    "src/agent-definitions/engineer.md",
    "src/agent-definitions/guide.md",
    "src/agent-definitions/ideator.md",
    "src/agent-definitions/operator.md",
    "src/agent-definitions/planner.md",
    "src/agent-definitions/recorder.md",
    "src/agent-definitions/router.md",
    "src/agent-definitions/tester.md",
];

/** @param {string} root */
async function writeRuntimeInputs(root) {
    await writeFile(join(root, "src/ui/workspace/remote-server.js"), "console.log('remote');\n");
    await writeFile(join(root, "dist/workspace-runtime/server.mjs"), "export default {};\n");
    await writeFile(join(root, "dist/workspace-runtime/client/_astro/app.js.asset"), "browser");
    await writeFile(join(root, "logo.svg"), "<svg></svg>\n");
    for (const asset of AGENT_DEFINITION_ASSETS) await writeFile(join(root, asset), "---\nname: test\n---\n");
    await writeFile(join(root, "src/ui/workspace/static/styles.css"), "body{}\n");
    await writeFile(join(root, "src/ui/workspace/static/workspace.css"), ".workspace{}\n");
    await writeFile(join(root, "src/ui/design-system/tokens.css"), ":root{}\n");
    await writeFile(join(root, "src/ui/design-system/components.css"), ".button{}\n");
    await writeFile(join(root, "src/ui/theme/catppuccin-mocha.json"), '{"name":"catppuccin-mocha"}\n');
}

Deno.test("listRuntimeAssetDestinations returns the passive asset allowlist", () => {
    assertEquals(listRuntimeAssetDestinations(), [
        "logo.svg",
        ...AGENT_DEFINITION_ASSETS,
        "src/ui/design-system/components.css",
        "src/ui/design-system/tokens.css",
        "src/ui/theme/catppuccin-mocha.json",
        "src/ui/workspace/static/styles.css",
        "src/ui/workspace/static/workspace.css",
    ]);
});

Deno.test("buildPlanServerRuntime creates a minimal runtime root", async () => {
    const root = await makeTempRoot();
    try {
        await writeRuntimeInputs(root);
        /** @type {Array<{ command: string, args: string[] }>} */
        const commands = [];
        await buildPlanServerRuntime({
            remoteEntry: join(root, "src/ui/workspace/remote-server.js"),
            workspaceRuntimeDir: join(root, "dist/workspace-runtime"),
            runtimeDir: join(root, "dist/plan-server"),
            run: async (command, args) => {
                commands.push({ command, args });
                const outputIndex = args.indexOf("--output");
                await writeFile(args[outputIndex + 1], "// bundled remote server\n");
            },
        });

        assertEquals(commands, [{
            command: "deno",
            args: [
                "bundle",
                "--platform",
                "deno",
                "--packages",
                "bundle",
                "--minify",
                "--output",
                join(root, "dist/plan-server/remote-server.js"),
                join(root, "src/ui/workspace/remote-server.js"),
            ],
        }]);

        assertEquals(await listRuntimeFiles(join(root, "dist/plan-server")), [
            "dist/workspace-runtime/client/_astro/app.js.asset",
            "dist/workspace-runtime/server.mjs",
            "logo.svg",
            "remote-server.js",
            ...AGENT_DEFINITION_ASSETS,
            "src/ui/design-system/components.css",
            "src/ui/design-system/tokens.css",
            "src/ui/theme/catppuccin-mocha.json",
            "src/ui/workspace/static/styles.css",
            "src/ui/workspace/static/workspace.css",
        ]);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("buildPlanServerRuntime removes stale output", async () => {
    const root = await makeTempRoot();
    try {
        await writeRuntimeInputs(root);
        await writeFile(join(root, "dist/plan-server/src/cli.js"), "stale");
        await buildPlanServerRuntime({
            remoteEntry: join(root, "src/ui/workspace/remote-server.js"),
            workspaceRuntimeDir: join(root, "dist/workspace-runtime"),
            runtimeDir: join(root, "dist/plan-server"),
            run: async (_command, args) => {
                await writeFile(args[args.indexOf("--output") + 1], "// bundled remote server\n");
            },
        });

        const files = await listRuntimeFiles(join(root, "dist/plan-server"));
        assertEquals(files.includes("src/cli.js"), false);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("buildPlanServerRuntime fails when required inputs are missing", async () => {
    const root = await makeTempRoot();
    try {
        await assertRejects(
            () =>
                buildPlanServerRuntime({
                    remoteEntry: join(root, "src/ui/workspace/remote-server.js"),
                    workspaceRuntimeDir: join(root, "dist/workspace-runtime"),
                    runtimeDir: join(root, "dist/plan-server"),
                    run: async () => {},
                }),
            Error,
            "Required Plan Server runtime file is missing",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("buildPlanServerRuntime fails clearly when Workspace runtime output lacks server entry", async () => {
    const root = await makeTempRoot();
    try {
        await writeRuntimeInputs(root);
        await Deno.remove(join(root, "dist/workspace-runtime/server.mjs"));
        let didRunBundle = false;

        await assertRejects(
            () =>
                buildPlanServerRuntime({
                    remoteEntry: join(root, "src/ui/workspace/remote-server.js"),
                    workspaceRuntimeDir: join(root, "dist/workspace-runtime"),
                    runtimeDir: join(root, "dist/plan-server"),
                    run: () => {
                        didRunBundle = true;
                        return Promise.resolve();
                    },
                }),
            Error,
            `Required Plan Server runtime file is missing: ${join(root, "dist/workspace-runtime/server.mjs")}`,
        );
        assertEquals(didRunBundle, false);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("required Workspace runtime file list includes the Astro server entry", () => {
    assertEquals(REQUIRED_WORKSPACE_RUNTIME_FILES, ["server.mjs"]);
});

Deno.test("findProhibitedRuntimeFiles rejects broad source and state copies", () => {
    assertEquals(
        findProhibitedRuntimeFiles([
            "remote-server.js",
            "dist/workspace-runtime/server.mjs",
            "src/ui/workspace/static/styles.css",
            "src/ui/workspace/server.js",
            "plans/example.md",
            ".wld/collaboration-secrets.json",
            "data/runwield.sqlite",
            ".git/config",
            "src/ui/workspace/workspace.test.js",
        ]),
        [
            "src/ui/workspace/server.js",
            "plans/example.md",
            ".wld/collaboration-secrets.json",
            "data/runwield.sqlite",
            ".git/config",
            "src/ui/workspace/workspace.test.js",
        ],
    );
});
