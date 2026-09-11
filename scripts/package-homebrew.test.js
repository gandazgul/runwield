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
                    testOnly: false,
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
                    testOnly: false,
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
                    testOnly: false,
                }),
            Error,
            "darwin-x64",
        );
    } finally {
        await fixture.close();
    }
});
