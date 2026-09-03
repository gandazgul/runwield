import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
    assertBinaryVersionOutput,
    assertBinaryWorkspaceHtml,
    assertExtractedBundledAgentReferenceFiles,
    assertRequiredBundledAssetsConfigured,
    assertReviewAssetsLoad,
    collectBundledAgentReferenceFiles,
    collectExtractedBundledMarkdownFiles,
    collectNestedReviewAssetUrls,
    collectReviewAssetUrls,
    parseReleaseCheckOptions,
    readReviewUrl,
    readWorkspaceUrl,
    runReleaseCheck,
} from "./release-check.js";

/**
 * @param {string} rootDir
 * @param {string} [relativeDir]
 * @returns {Promise<string[]>}
 */
async function collectMarkdownFiles(rootDir, relativeDir = "") {
    /** @type {string[]} */
    const files = [];
    const currentDir = relativeDir ? join(rootDir, ...relativeDir.split("/")) : rootDir;
    for await (const entry of Deno.readDir(currentDir)) {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory) files.push(...await collectMarkdownFiles(rootDir, relativePath));
        else if (entry.isFile && entry.name.endsWith(".md")) files.push(relativePath);
    }
    return files.sort();
}

Deno.test("parseReleaseCheckOptions accepts explicit build identity", () => {
    assertEquals(parseReleaseCheckOptions(["--build-version", "v1.2.3-rc.1"]), { buildVersion: "v1.2.3-rc.1" });
    assertEquals(parseReleaseCheckOptions([]), { buildVersion: undefined });
});

Deno.test("assertBinaryVersionOutput requires the requested release identity", () => {
    assertBinaryVersionOutput("runwield v1.2.3-rc.1 (x86_64-unknown-linux-gnu)\n", "v1.2.3-rc.1");
    assertThrows(
        () => assertBinaryVersionOutput("runwield v1.2.3 (x86_64-unknown-linux-gnu)\n", "v1.2.3-rc.1"),
        Error,
        "wrong version",
    );
});

/**
 * @param {(root: string) => Promise<void>} fn
 */
async function withTemporaryVersionProject(fn) {
    const root = await Deno.makeTempDir({ prefix: "wld-release-check-project-" });
    try {
        await Deno.mkdir(join(root, "src", "shared"), { recursive: true });
        await Deno.writeTextFile(join(root, "src", "shared", "version.js"), 'export const VERSION = "original";\n');
        await fn(root);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
}

Deno.test("runReleaseCheck propagates build identity to compile and preserves stage order", async () => {
    await withTemporaryVersionProject(async (root) => {
        /** @type {string[]} */
        const stages = [];
        /** @type {Array<{ command: string, args: string[], env?: Record<string, string> }>} */
        const calls = [];
        await runReleaseCheck({
            buildVersion: "v1.2.3-rc.1",
            rootDir: root,
        }, {
            makeTempDir: () => Promise.resolve("release-temp"),
            remove: () => Promise.resolve(),
            async run(command, args, options = {}) {
                calls.push({ command, args, env: options.env });
                if (command === "deno" && args.includes("scripts/compile.js")) {
                    stages.push("compile");
                    await Deno.writeTextFile(
                        join(root, "src", "shared", "version.js"),
                        'export const VERSION = "compiled";\n',
                    );
                    return { success: true, code: 0, stdout: "", stderr: "" };
                }
                if (command === "deno" && args.includes("test:golden-tui:extensive")) {
                    stages.push("golden-tui");
                    return { success: true, code: 0, stdout: "", stderr: "" };
                }
                if (command === "deno") {
                    stages.push("workspace-review-routes");
                    return { success: true, code: 0, stdout: "", stderr: "" };
                }
                stages.push("version");
                return {
                    success: true,
                    code: 0,
                    stdout: "runwield v1.2.3-rc.1 (test-target)\n",
                    stderr: "",
                };
            },
            smokeTestBundledAgentReferenceExtraction() {
                stages.push("references");
                return Promise.resolve();
            },
            smokeTestBinaryPlansUiSurface() {
                stages.push("plans-ui");
                return Promise.resolve();
            },
            smokeTestBinaryReviewSurface() {
                stages.push("review");
                return Promise.resolve();
            },
        });

        assertEquals(stages, [
            "compile",
            "workspace-review-routes",
            "version",
            "references",
            "plans-ui",
            "review",
            "golden-tui",
        ]);
        assertEquals(calls[0].env, { WLD_BUILD_VERSION: "v1.2.3-rc.1" });
        assertEquals(
            await Deno.readTextFile(join(root, "src", "shared", "version.js")),
            'export const VERSION = "original";\n',
        );
    });
});

Deno.test("runReleaseCheck short-circuits after compile failure and restores generated version", async () => {
    await withTemporaryVersionProject(async (root) => {
        /** @type {string[]} */
        const stages = [];
        await assertRejects(
            () =>
                runReleaseCheck({
                    buildVersion: "v1.2.3",
                    rootDir: root,
                }, {
                    makeTempDir: () => Promise.resolve("release-temp"),
                    remove: () => Promise.resolve(),
                    async run(command) {
                        stages.push(command === "deno" ? "compile" : "version");
                        await Deno.writeTextFile(
                            join(root, "src", "shared", "version.js"),
                            'export const VERSION = "failed";\n',
                        );
                        return { success: false, code: 1, stdout: "", stderr: "compile failed" };
                    },
                    smokeTestBundledAgentReferenceExtraction() {
                        stages.push("references");
                        return Promise.resolve();
                    },
                    smokeTestBinaryPlansUiSurface() {
                        stages.push("plans-ui");
                        return Promise.resolve();
                    },
                    smokeTestBinaryReviewSurface() {
                        stages.push("review");
                        return Promise.resolve();
                    },
                }),
            Error,
            "Compile release binary failed",
        );

        assertEquals(stages, ["compile"]);
        assertEquals(
            await Deno.readTextFile(join(root, "src", "shared", "version.js")),
            'export const VERSION = "original";\n',
        );
    });
});

Deno.test("runReleaseCheck restores generated version after binary version mismatch", async () => {
    await withTemporaryVersionProject(async (root) => {
        /** @type {string[]} */
        const stages = [];
        await assertRejects(
            () =>
                runReleaseCheck({
                    buildVersion: "v1.2.3-rc.1",
                    rootDir: root,
                }, {
                    makeTempDir: () => Promise.resolve("release-temp"),
                    remove: () => Promise.resolve(),
                    async run(command, args) {
                        if (command === "deno" && args.includes("scripts/compile.js")) {
                            stages.push("compile");
                            await Deno.writeTextFile(
                                join(root, "src", "shared", "version.js"),
                                'export const VERSION = "compiled";\n',
                            );
                            return { success: true, code: 0, stdout: "", stderr: "" };
                        }
                        if (command === "deno") {
                            stages.push("workspace-review-routes");
                            return { success: true, code: 0, stdout: "", stderr: "" };
                        }
                        stages.push("version");
                        return { success: true, code: 0, stdout: "runwield v1.2.3 (test-target)\n", stderr: "" };
                    },
                    smokeTestBundledAgentReferenceExtraction() {
                        stages.push("references");
                        return Promise.resolve();
                    },
                    smokeTestBinaryPlansUiSurface() {
                        stages.push("plans-ui");
                        return Promise.resolve();
                    },
                    smokeTestBinaryReviewSurface() {
                        stages.push("review");
                        return Promise.resolve();
                    },
                }),
            Error,
            "wrong version",
        );

        assertEquals(stages, ["compile", "workspace-review-routes", "version"]);
        assertEquals(
            await Deno.readTextFile(join(root, "src", "shared", "version.js")),
            'export const VERSION = "original";\n',
        );
    });
});

Deno.test("release compile includes required bundled markdown and theme assets", () => {
    assertRequiredBundledAssetsConfigured();
});

Deno.test("readReviewUrl extracts Plan review URL from command output", () => {
    assertEquals(
        readReviewUrl("[RunWield] Plan read-only view: http://127.0.0.1:1234/review/plan?token=abc-123\n"),
        "http://127.0.0.1:1234/review/plan?token=abc-123",
    );
});

Deno.test("readWorkspaceUrl extracts Plans UI URL from command output", () => {
    assertEquals(
        readWorkspaceUrl("[RunWield] Workspace: http://127.0.0.1:1234/?token=abc-123\n"),
        "http://127.0.0.1:1234/?token=abc-123",
    );
});

Deno.test("assertBinaryWorkspaceHtml requires the real built Workspace shell", () => {
    assertBinaryWorkspaceHtml(
        '<main data-astro-workspace-shell><astro-island component-url="/_astro/Workspace.js"></astro-island></main>',
    );
    assertThrows(
        () => assertBinaryWorkspaceHtml("Workspace Astro build unavailable"),
        Error,
        "Workspace build-unavailable",
    );
});

Deno.test("collectReviewAssetUrls finds Astro assets needed by review HTML", () => {
    const html =
        '<link rel="stylesheet" href="/_astro/app.css"><astro-island component-url="/_astro/Review.js"></astro-island>';

    assertEquals(collectReviewAssetUrls(html, "http://127.0.0.1:1234/review/plan?token=test"), [
        "http://127.0.0.1:1234/_astro/app.css",
        "http://127.0.0.1:1234/_astro/Review.js",
    ]);
});

Deno.test("collectNestedReviewAssetUrls finds dynamic import chunks", () => {
    const source =
        'const chunk = () => import("./ArtifactReadSurface.js"); import { x } from "./client.js"; import "./side-effect.js";';

    assertEquals(collectNestedReviewAssetUrls(source, "http://127.0.0.1:1234/_astro/Review.js"), [
        "http://127.0.0.1:1234/_astro/ArtifactReadSurface.js",
        "http://127.0.0.1:1234/_astro/client.js",
        "http://127.0.0.1:1234/_astro/side-effect.js",
    ]);
});

Deno.test("collectBundledAgentReferenceFiles covers all agent definitions, prompts, and plan formats", async () => {
    assertEquals(
        await collectBundledAgentReferenceFiles(),
        await collectMarkdownFiles(join("src", "agent-definitions")),
    );
});

Deno.test("collectExtractedBundledMarkdownFiles covers agent definitions and bundled skills", async () => {
    const extracted = await collectExtractedBundledMarkdownFiles();
    assertEquals(
        extracted.map((file) => `${file.cacheDir}/${file.relativePath}`),
        [
            ...(await collectMarkdownFiles(join("src", "agent-definitions"))).map((path) =>
                `.wld/bundled-agent-definitions/${path}`
            ),
            ...(await collectMarkdownFiles(join("src", "skills"))).map((path) => `.wld/bundled-skills/${path}`),
        ].sort((a, b) => a.localeCompare(b)),
    );
});

Deno.test("assertExtractedBundledAgentReferenceFiles accepts copied bundled markdown", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "runwield-reference-home-" });
    try {
        for (const { sourceDir, cacheDir, relativePath } of await collectExtractedBundledMarkdownFiles()) {
            const relativeParts = relativePath.split("/");
            const targetDir = join(homeDir, cacheDir, ...relativeParts.slice(0, -1));
            const targetPath = join(targetDir, relativeParts.at(-1) || "");
            const source = await Deno.readTextFile(join(sourceDir, relativePath));
            await Deno.mkdir(targetDir, { recursive: true });
            await Deno.writeTextFile(targetPath, source);
        }

        await assertExtractedBundledAgentReferenceFiles(homeDir);
    } finally {
        await Deno.remove(homeDir, { recursive: true });
    }
});

Deno.test("assertExtractedBundledAgentReferenceFiles rejects missing bundled markdown", async () => {
    const homeDir = await Deno.makeTempDir({ prefix: "runwield-reference-home-missing-" });
    try {
        await assertRejects(
            () => assertExtractedBundledAgentReferenceFiles(homeDir),
            Error,
            "Release binary did not extract bundled agent definition markdown file",
        );
    } finally {
        await Deno.remove(homeDir, { recursive: true });
    }
});

Deno.test("assertReviewAssetsLoad fails when a dynamic review chunk is missing", async () => {
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/_astro/Review.js") {
            return new Response('export const load = () => import("./MissingChunk.js");', {
                headers: { "content-type": "application/javascript" },
            });
        }
        return new Response("Not found", { status: 404 });
    });
    const pageUrl = `http://127.0.0.1:${server.addr.port}/review/plan?token=test`;
    const html = '<astro-island component-url="/_astro/Review.js"></astro-island>';

    try {
        await assertRejects(
            () => assertReviewAssetsLoad(pageUrl, html),
            Error,
            "Review UI asset failed to load (404)",
        );
    } finally {
        await server.shutdown();
    }
});
