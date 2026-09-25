import { assertEquals, assertRejects } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { sha256Bytes } from "../../../scripts/build-metadata.js";
import { linuxTarget } from "./runtime.js";

const BUILD_ID = "a".repeat(64);
const PROTOCOL = 1;

/**
 * @typedef {Object} RuntimeFixture
 * @property {string} root
 * @property {string} ssh
 * @property {string} artifact
 * @property {typeof import('./runtime.js')} module
 * @property {FixtureMetadata} metadata
 */
/**
 * @typedef {Object} FixtureMetadata
 * @property {number} schema
 * @property {number} protocol
 * @property {string} buildId
 * @property {string} target
 * @property {string} version
 * @property {string} sha256
 */
/** @param {(fixture: RuntimeFixture) => Promise<void>} fn */
async function fixture(fn) {
    const root = await Deno.realPath(await Deno.makeTempDir());
    try {
        const shared = join(root, "src/shared");
        const remote = join(shared, "remote");
        await Deno.mkdir(remote, { recursive: true });
        await Deno.mkdir(join(root, "scripts"));
        for (
            const [source, destination] of [
                ["src/shared/remote/runtime.js", join(remote, "runtime.js")],
                ["src/shared/remote/target.js", join(remote, "target.js")],
                ["scripts/build-metadata.js", join(root, "scripts/build-metadata.js")],
            ]
        ) await Deno.copyFile(source, destination);
        await Deno.writeTextFile(
            join(shared, "build-identity.js"),
            `export const BUILD_ID = '${BUILD_ID}'; export const REMOTE_PROTOCOL_VERSION = ${PROTOCOL};`,
        );
        await Deno.writeTextFile(join(shared, "version.js"), 'export const VERSION = "test-build";');
        const module = await import(toFileUrl(join(remote, "runtime.js")).href);
        const ssh = join(root, "ssh");
        await Deno.writeTextFile(
            ssh,
            `#!/bin/sh\n[ "$1" = -T ] && [ "$2" = -- ] && [ "$3" = example ] || exit 42\nHOME=${
                JSON.stringify(root)
            } export HOME\ntee ${JSON.stringify(join(root, "transfer"))} | sh -c "$4"\n`,
        );
        await Deno.chmod(ssh, 0o700);
        const artifact = join(root, "artifact");
        const content =
            `#!/bin/sh\n[ "$1" = --remote-preflight ] || exit 2\necho '{"buildId":"${BUILD_ID}","protocol":${PROTOCOL},"version":"test-build"}'\n`;
        await Deno.writeTextFile(artifact, content);
        const checksum = await sha256Bytes(new TextEncoder().encode(content));
        const metadata = {
            schema: 1,
            protocol: PROTOCOL,
            buildId: BUILD_ID,
            target: "x86_64-unknown-linux-gnu",
            version: "test-build",
            sha256: checksum,
        };
        await Deno.writeTextFile(artifact + ".build.json", JSON.stringify(metadata));
        await fn({ root, ssh, artifact, module, metadata });
    } finally {
        await Deno.remove(root, { recursive: true });
    }
}

Deno.test("GNU Linux platform selection rejects unsupported hosts", () => {
    assertEquals(linuxTarget({ os: "Linux", arch: "x86_64" }), "x86_64-unknown-linux-gnu");
    assertEquals(linuxTarget({ os: "Linux", arch: "aarch64" }), "aarch64-unknown-linux-gnu");
    for (const platform of [{ os: "Darwin", arch: "x86_64" }, { os: "Linux", arch: "armv7" }]) {
        try {
            linuxTarget(platform);
            throw new Error("Accepted unsupported platform");
        } catch (error) {
            if (error instanceof Error && error.message === "Accepted unsupported platform") throw error;
        }
    }
});

Deno.test("remote cache promotes verified runtime and reuses it after preflight", async () => {
    await fixture(async ({ root, ssh, artifact, module }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        const first = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(first.reused, false);
        const firstTransferBytes = (await Deno.stat(join(root, "transfer"))).size;
        assertEquals(((await Deno.stat(first.path)).mode ?? 0) & 0o777, 0o700);
        const second = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(second.path, first.path);
        assertEquals(second.reused, true);
        const secondTransferBytes = (await Deno.stat(join(root, "transfer"))).size;
        assertEquals(secondTransferBytes < firstTransferBytes, true);
        const abandoned = join(first.path, "../.stage-abandoned");
        await Deno.writeTextFile(abandoned, "incomplete");
        await Deno.writeTextFile(first.path, "broken");
        const repaired = await module.prepareRemoteRuntime("example", platform, artifact, ssh);
        assertEquals(repaired.reused, false);
        assertEquals(await Deno.stat(abandoned).then(() => true).catch(() => false), false);
        assertEquals(await Deno.readTextFile(repaired.path), await Deno.readTextFile(artifact));
    });
});

Deno.test("ARM64 GNU metadata selects a separate verified cache entry", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        await Deno.writeTextFile(
            artifact + ".build.json",
            JSON.stringify({ ...metadata, target: "aarch64-unknown-linux-gnu" }),
        );
        const result = await module.prepareRemoteRuntime("example", { os: "Linux", arch: "aarch64" }, artifact, ssh);
        assertEquals(result.path.includes("aarch64-unknown-linux-gnu"), true);
        assertEquals(await Deno.readTextFile(result.path), await Deno.readTextFile(artifact));
    });
});

Deno.test("concurrent setup leaves a complete runtime for both callers", async () => {
    await fixture(async ({ ssh, artifact, module }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        const [first, second] = await Promise.all([
            module.prepareRemoteRuntime("example", platform, artifact, ssh),
            module.prepareRemoteRuntime("example", platform, artifact, ssh),
        ]);
        assertEquals(first.path, second.path);
        assertEquals(await Deno.readTextFile(first.path), await Deno.readTextFile(artifact));
        assertEquals((await module.prepareRemoteRuntime("example", platform, artifact, ssh)).reused, true);
    });
});

Deno.test("missing artifact and incorrect architecture fail before transfer", async () => {
    await fixture(async ({ ssh, artifact, module }) => {
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact + "-absent", ssh),
            Error,
            "--target x86_64-unknown-linux-gnu",
        );
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "aarch64" }, artifact, ssh),
            Error,
            "does not match",
        );
    });
});

Deno.test("an artifact with forged embedded identity fails remote preflight", async () => {
    await fixture(async ({ root, ssh, artifact, module, metadata }) => {
        await Deno.writeTextFile(
            artifact,
            '#!/bin/sh\necho \'{"buildId":"wrong","protocol":1,"version":"test-build"}\'\n',
        );
        const sha256 = await sha256Bytes(await Deno.readFile(artifact));
        await Deno.writeTextFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256 }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "embedded identity",
        );
        const cached = join(root, ".cache/runwield/runtime", BUILD_ID, metadata.target, sha256, "wld");
        assertEquals(await Deno.stat(cached).then(() => true).catch(() => false), false);
    });
});

Deno.test("a mismatched artifact VERSION fails locally before transfer", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        await Deno.writeTextFile(artifact + ".build.json", JSON.stringify({ ...metadata, version: "other-release" }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "artifact VERSION",
        );
    });
});

Deno.test("a matching build with a different human version fails remote preflight", async () => {
    await fixture(async ({ ssh, artifact, module, metadata }) => {
        const content = (await Deno.readTextFile(artifact)).replace("test-build", "other-release");
        await Deno.writeTextFile(artifact, content);
        const sha256 = await sha256Bytes(await Deno.readFile(artifact));
        await Deno.writeTextFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256 }));
        await assertRejects(
            () => module.prepareRemoteRuntime("example", { os: "Linux", arch: "x86_64" }, artifact, ssh),
            Error,
            "mismatch: version",
        );
    });
});

Deno.test("corrupt, mismatched and non-executable artifacts do not become runnable", async () => {
    await fixture(async ({ root, ssh, artifact, module, metadata }) => {
        const platform = { os: "Linux", arch: "x86_64" };
        await Deno.writeTextFile(artifact, "corrupt");
        await assertRejects(() => module.prepareRemoteRuntime("example", platform, artifact, ssh), Error, "checksum");
        await Deno.writeTextFile(artifact, "#!/bin/sh\nexit 1\n");
        const checksum = await sha256Bytes(await Deno.readFile(artifact));
        await Deno.writeTextFile(artifact + ".build.json", JSON.stringify({ ...metadata, sha256: checksum }));
        await assertRejects(() => module.prepareRemoteRuntime("example", platform, artifact, ssh), Error, "preflight");
        const cache = join(root, ".cache/runwield/runtime", BUILD_ID, metadata.target, checksum);
        assertEquals(await Deno.stat(join(cache, "wld")).then(() => true).catch(() => false), false);
        await Deno.writeTextFile(
            artifact + ".build.json",
            JSON.stringify({ ...metadata, sha256: checksum, buildId: "b".repeat(64) }),
        );
        await assertRejects(
            () => module.prepareRemoteRuntime("example", platform, artifact, ssh),
            Error,
            "does not match",
        );
    });
});
