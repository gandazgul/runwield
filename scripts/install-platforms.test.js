import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import {
    BINARY_NAMES,
    createFixture,
    readCurlLog,
    RELEASE_BINARY_NAMES,
    runInstaller,
    VERSIONS,
    writeExecutable,
} from "./install-test-helpers.js";

Deno.test("install.sh maps Darwin/Linux amd64/arm64 assets and preserves positional wld version", async (t) => {
    /** @type {Array<{ os: import("./install-test-helpers.js").TestOs, arch: import("./install-test-helpers.js").TestArch }>} */
    const platforms = [
        { os: "Darwin", arch: "x86_64" },
        { os: "Darwin", arch: "arm64" },
        { os: "Linux", arch: "x86_64" },
        { os: "Linux", arch: "arm64" },
    ];

    for (const platform of platforms) {
        await t.step(`${platform.os} ${platform.arch}`, async () => {
            const fixture = await createFixture(platform);
            try {
                const result = await runInstaller(fixture, { requestedVersion: VERSIONS.runwield });
                assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
                const curlLog = await readCurlLog(fixture.curlLog);
                for (const name of RELEASE_BINARY_NAMES) {
                    assertStringIncludes(curlLog, fixture.assets[name]);
                }
                for (const name of BINARY_NAMES) {
                    const stat = await Deno.stat(join(fixture.installDir, name));
                    assertEquals(stat.isFile, true);
                }
                assertStringIncludes(curlLog, `/download/${VERSIONS.runwield}/${fixture.assets.wld}`);
            } finally {
                await Deno.remove(fixture.root, { recursive: true });
            }
        });
    }
});

Deno.test("install.sh preserves helpers on PATH and in install dir, and idempotent reruns skip helper downloads", async () => {
    const fixture = await createFixture();
    const externalBin = join(fixture.root, "external-bin");
    await Deno.mkdir(externalBin);
    await writeExecutable(join(externalBin, "mnemosyne"), "#!/usr/bin/env bash\necho external mnemosyne\n");
    await writeExecutable(join(fixture.installDir, "cymbal"), "#!/usr/bin/env bash\necho existing cymbal\n");
    try {
        const first = await runInstaller(fixture, { extraPathDir: externalBin });
        assertEquals(first.code, 0, `${first.stdout}\n${first.stderr}`);
        assertStringIncludes(first.stdout, "Preserving existing mnemosyne");
        assertStringIncludes(first.stdout, "Preserving existing cymbal");
        assertStringIncludes(first.stdout, "agent-browser");
        assertStringIncludes(first.stdout, "snip");

        await Deno.writeTextFile(fixture.curlLog, "");
        const second = await runInstaller(fixture, { extraPathDir: externalBin });
        assertEquals(second.code, 0, `${second.stdout}\n${second.stderr}`);
        assertStringIncludes(second.stdout, "Preserving existing mnemosyne");
        assertStringIncludes(second.stdout, "Preserving existing cymbal");
        assertStringIncludes(second.stdout, "Preserving existing snip");
        const curlLog = await readCurlLog(fixture.curlLog);
        assertEquals(curlLog.includes("mnemosyne_"), false);
        assertEquals(curlLog.includes("cymbal_"), false);
        assertEquals(curlLog.includes("snip_"), false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("ux:new-user image provisions Node 24 for required agent-browser helper", async () => {
    const containerfile = await Deno.readTextFile("Containerfile.wld-ux");
    assertStringIncludes(containerfile, "https://deb.nodesource.com/node_24.x");
    assertStringIncludes(containerfile, "node --version");
    assertStringIncludes(containerfile, "command -v wld mnemosyne cymbal agent-browser snip");
});

Deno.test("ux:new-user tasks build latest and current targets from one containerfile", async () => {
    const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
    assertStringIncludes(denoJson.tasks["ux:new-user"], "--target wld-ux-latest");
    assertStringIncludes(denoJson.tasks["ux:new-user"], "-f Containerfile.wld-ux");

    const currentTask = denoJson.tasks["ux:new-user:current"];
    assertStringIncludes(currentTask, "deno task compile --target");
    assertStringIncludes(currentTask, "--target wld-ux-current");
    assertStringIncludes(currentTask, "-f Containerfile.wld-ux");
    assertStringIncludes(currentTask, "runwield-wld-ux-current:local");

    const containerfile = await Deno.readTextFile("Containerfile.wld-ux");
    assertStringIncludes(containerfile, "FROM wld-ux-base AS wld-ux-latest");
    assertStringIncludes(containerfile, "FROM wld-ux-base AS wld-ux-current");
    assertStringIncludes(containerfile, "COPY --chown=deno:deno bin/wld /tmp/wld-current");
    assertStringIncludes(containerfile, 'install -m 755 /tmp/wld-current "$WLD_INSTALL_DIR/wld"');

    const containerignore = await Deno.readTextFile(".containerignore");
    assertStringIncludes(containerignore, "!bin/wld");
});
