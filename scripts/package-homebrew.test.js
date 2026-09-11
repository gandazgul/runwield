import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { packageHomebrew } from "./package-homebrew.js";

/** @param {Uint8Array} bytes */
async function sha256Text(bytes) {
    const input = new Uint8Array(bytes.length);
    input.set(bytes);
    const hash = await crypto.subtle.digest("SHA-256", input.buffer);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} root
 * @param {string} name
 * @param {string} text
 */
async function writeAsset(root, name, text) {
    const bytes = new TextEncoder().encode(text);
    await Deno.writeFile(join(root, name), bytes);
    return await sha256Text(bytes);
}

async function makeReleaseFixture() {
    const root = await Deno.makeTempDir({ prefix: "runwield-homebrew-release-" });
    /**
     * @param {string} name
     * @param {string} text
     */
    async function add(name, text) {
        return await writeAsset(root, name, text);
    }

    const wldArm = await add("wld-v1.2.3-darwin-arm64.tar.gz", "wld arm");
    const wldX64 = await add("wld-v1.2.3-darwin-x64.tar.gz", "wld x64");
    await add("wld-v1.2.3-darwin-arm64.tar.gz.sha256", `${wldArm}  wld-v1.2.3-darwin-arm64.tar.gz\n`);
    await add("wld-v1.2.3-darwin-x64.tar.gz.sha256", `${wldX64}  wld-v1.2.3-darwin-x64.tar.gz\n`);
    const memArm = await add("mnemoteca_0.3.1_darwin_arm64.tar.gz", "memory arm");
    const memX64 = await add("mnemoteca_0.3.1_darwin_amd64.tar.gz", "memory x64");

    const abort = new AbortController();
    const server = Deno.serve(
        { port: 0, hostname: "127.0.0.1", signal: abort.signal, onListen() {} },
        async (request) => {
            const path = new URL(request.url).pathname.slice(1);
            try {
                return new Response(await Deno.readFile(join(root, path)));
            } catch {
                return new Response("not found", { status: 404 });
            }
        },
    );
    const port = server.addr.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const inputsPath = join(root, "inputs.json");
    await Deno.writeTextFile(
        inputsPath,
        JSON.stringify({
            mnemoteca: {
                tag: "v0.3.1",
                license: "MIT",
                homepage: "https://github.com/gandazgul/mnemoteca",
                assets: {
                    "darwin-arm64": {
                        url: `${baseUrl}/mnemoteca_0.3.1_darwin_arm64.tar.gz`,
                        sha256: memArm,
                    },
                    "darwin-x64": {
                        url: `${baseUrl}/mnemoteca_0.3.1_darwin_amd64.tar.gz`,
                        sha256: memX64,
                    },
                },
            },
            homebrewDependencies: {
                cymbal: { formula: "1broseidon/tap/cymbal", testedVersion: "v0.7.7" },
            },
        }),
    );
    return {
        root,
        baseUrl,
        inputsPath,
        close: async () => {
            abort.abort();
            await server.finished.catch(() => {});
            await Deno.remove(root, { recursive: true });
        },
    };
}

Deno.test("package:homebrew renders formulas from verified immutable assets", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const output = join(fixture.root, "tap");
        await packageHomebrew({
            wldTag: "v1.2.3",
            mnemotecaTag: "v0.3.1",
            output,
            inputsPath: fixture.inputsPath,
            wldBaseUrl: fixture.baseUrl,
            mnemotecaBaseUrl: fixture.baseUrl,
            testOnly: true,
        });

        const wld = await Deno.readTextFile(join(output, "Formula", "wld.rb"));
        const mnemoteca = await Deno.readTextFile(join(output, "Formula", "mnemoteca.rb"));
        assertStringIncludes(wld, "class Wld < Formula");
        assertStringIncludes(wld, 'depends_on "gandazgul/tap/mnemoteca"');
        assertStringIncludes(wld, "runwield-install.json");
        assertStringIncludes(wld, "brew upgrade gandazgul/tap/wld");
        assertStringIncludes(
            wld,
            'version "1.2.3"\n  license "https://github.com/gandazgul/runwield/blob/v#{version}/LICENSE"',
        );
        assertStringIncludes(wld, "# test-only artifact; do not publish this formula");
        assertStringIncludes(mnemoteca, "class Mnemoteca < Formula");
        assertStringIncludes(mnemoteca, "mnemoteca_0.3.1_darwin_arm64.tar.gz");
        const manifest = JSON.parse(await Deno.readTextFile(join(output, "runwield-homebrew-package.json")));
        assertEquals(manifest.testOnly, true);
        assertEquals(manifest.formulas, ["Formula/wld.rb", "Formula/mnemoteca.rb"]);
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects RC tags before emitting output", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const output = join(fixture.root, "tap");
        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "v1.2.3-rc.1",
                    mnemotecaTag: "v0.3.1",
                    output,
                    inputsPath: fixture.inputsPath,
                    wldBaseUrl: fixture.baseUrl,
                    mnemotecaBaseUrl: fixture.baseUrl,
                    testOnly: true,
                }),
            Error,
            "Stable tag",
        );
        await assertRejects(() => Deno.stat(output), Deno.errors.NotFound);
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects corrupt release bytes", async () => {
    const fixture = await makeReleaseFixture();
    try {
        await Deno.writeTextFile(join(fixture.root, "wld-v1.2.3-darwin-arm64.tar.gz"), "corrupt");
        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "v1.2.3",
                    mnemotecaTag: "v0.3.1",
                    output: join(fixture.root, "tap"),
                    inputsPath: fixture.inputsPath,
                    wldBaseUrl: fixture.baseUrl,
                    mnemotecaBaseUrl: fixture.baseUrl,
                    testOnly: true,
                }),
            Error,
            "Checksum mismatch",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects incomplete platform assets", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const inputs = JSON.parse(await Deno.readTextFile(fixture.inputsPath));
        delete inputs.mnemoteca.assets["darwin-x64"];
        await Deno.writeTextFile(fixture.inputsPath, JSON.stringify(inputs));
        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "v1.2.3",
                    mnemotecaTag: "v0.3.1",
                    output: join(fixture.root, "tap"),
                    inputsPath: fixture.inputsPath,
                    wldBaseUrl: fixture.baseUrl,
                    mnemotecaBaseUrl: fixture.baseUrl,
                    testOnly: true,
                }),
            Error,
            "darwin-x64",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects base URL overrides for publishable output", async () => {
    const fixture = await makeReleaseFixture();
    try {
        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "v1.2.3",
                    mnemotecaTag: "v0.3.1",
                    output: join(fixture.root, "tap"),
                    inputsPath: fixture.inputsPath,
                    wldBaseUrl: fixture.baseUrl,
                    testOnly: false,
                }),
            Error,
            "Base URL overrides require --test-only",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects missing publishable license metadata", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const inputs = JSON.parse(await Deno.readTextFile(fixture.inputsPath));
        delete inputs.mnemoteca.license;
        await Deno.writeTextFile(fixture.inputsPath, JSON.stringify(inputs));
        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "",
                    mnemotecaTag: "v0.3.1",
                    output: join(fixture.root, "tap"),
                    inputsPath: fixture.inputsPath,
                    mnemotecaBaseUrl: fixture.baseUrl,
                    testOnly: true,
                }),
            Error,
            "license and homepage",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew rejects publishable Mnemoteca refresh over test-only RunWield", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const output = join(fixture.root, "tap");
        await Deno.mkdir(join(output, "Formula"), { recursive: true });
        await Deno.writeTextFile(
            join(output, "Formula", "wld.rb"),
            'url "http://127.0.0.1/wld-v1.2.3-darwin-arm64.tar.gz"\n# test-only artifact; do not publish this formula\n',
        );
        await Deno.writeTextFile(
            join(output, "runwield-homebrew-package.json"),
            JSON.stringify({ testOnly: true, wldTag: "v1.2.3", formulas: ["Formula/wld.rb"] }),
        );

        await assertRejects(
            () =>
                packageHomebrew({
                    wldTag: "",
                    mnemotecaTag: "v0.3.1",
                    output,
                    inputsPath: fixture.inputsPath,
                    testOnly: false,
                }),
            Error,
            "test-only RunWield formula",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:homebrew refreshes only Mnemoteca when wld tag is omitted", async () => {
    const fixture = await makeReleaseFixture();
    try {
        const output = join(fixture.root, "tap");
        await Deno.mkdir(join(output, "Formula"), { recursive: true });
        await Deno.writeTextFile(join(output, "Formula", "wld.rb"), "preserved wld formula\n");
        await Deno.writeTextFile(
            join(output, "runwield-homebrew-package.json"),
            JSON.stringify({ testOnly: true, wldTag: "v1.2.3", formulas: ["Formula/wld.rb"] }),
        );
        await packageHomebrew({
            wldTag: "",
            mnemotecaTag: "v0.3.1",
            output,
            inputsPath: fixture.inputsPath,
            mnemotecaBaseUrl: fixture.baseUrl,
            testOnly: true,
        });

        assertEquals(await Deno.readTextFile(join(output, "Formula", "wld.rb")), "preserved wld formula\n");
        const mnemoteca = await Deno.readTextFile(join(output, "Formula", "mnemoteca.rb"));
        assertStringIncludes(mnemoteca, "class Mnemoteca < Formula");
        const manifest = JSON.parse(await Deno.readTextFile(join(output, "runwield-homebrew-package.json")));
        assertEquals(manifest.testOnly, true);
        assertEquals(manifest.wldTag, "v1.2.3");
        assertEquals(manifest.formulas, ["Formula/wld.rb", "Formula/mnemoteca.rb"]);
    } finally {
        await fixture.close();
    }
});
