import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { computeBuildIdentity, sha256File, verifyBuildArtifact } from "./build-metadata.js";
import { prepareDevelopmentArtifacts } from "./release-assets.js";
import { writeBuildIdentityFile } from "./write-version.js";

async function fixture() {
    const root = await Deno.makeTempDir();
    for (
        const dir of [
            "src/shared",
            "scripts",
            "third_party/plannotator/packages",
            "brand",
            "dist/workspace-runtime",
            "node_modules/@earendil-works/pi-coding-agent/dist/utils",
        ]
    ) {
        await Deno.mkdir(join(root, dir), { recursive: true });
    }
    for (
        const file of [
            "deno.json",
            "deno.lock",
            "config.schema.json",
            "image-resize-worker.js",
            "src/cli.ts",
            "src/shared/version.js",
            "scripts/compile.js",
            "dist/workspace-runtime/server.mjs",
            "node_modules/@earendil-works/pi-coding-agent/dist/utils/worker.js",
        ]
    ) {
        await Deno.writeTextFile(join(root, file), "initial");
    }
    return root;
}

Deno.test("common identity changes for dirty included source and resources, not generated identity/version", async () => {
    const root = await fixture();
    try {
        const identity = () => computeBuildIdentity(root, "2.9.7", ["compile", "--bundle"]);
        const first = await identity();
        await writeBuildIdentityFile(join(root, "src/shared/build-identity.js"), first);
        await Deno.writeTextFile(join(root, "src/shared/version.js"), "release");
        assertEquals(await identity(), first);
        await Deno.writeTextFile(join(root, "src/cli.ts"), "dirty, same commit");
        assertNotEquals(await identity(), first);
        const changed = await identity();
        await Deno.writeTextFile(join(root, "dist/workspace-runtime/server.mjs"), "changed resource");
        assertNotEquals(await identity(), changed);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("common identity includes lock, compiler version/options and explicit npm resources", async () => {
    const root = await fixture();
    try {
        const identity = () => computeBuildIdentity(root, "2.9.7", ["--bundle"]);
        const first = await identity();
        assertNotEquals(await computeBuildIdentity(root, "2.9.8", ["--bundle"]), first);
        assertNotEquals(await computeBuildIdentity(root, "2.9.7", ["--minify"]), first);
        for (const file of ["deno.lock", "node_modules/@earendil-works/pi-coding-agent/dist/utils/worker.js"]) {
            await Deno.writeTextFile(join(root, file), "changed");
            assertNotEquals(await identity(), first);
        }
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("development bundle verifies all checksums, build identities and GNU targets before staging", async () => {
    const root = await Deno.makeTempDir();
    const paths = ["launcher", "x64", "arm64"].map((name) => join(root, name));
    const targets = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"];
    const output = join(root, "bundle");
    try {
        for (let index = 0; index < paths.length; index++) {
            await Deno.writeTextFile(paths[index], `binary ${index}`);
            await Deno.writeTextFile(
                `${paths[index]}.build.json`,
                JSON.stringify({
                    schema: 1,
                    protocol: 1,
                    buildId: "a".repeat(64),
                    target: targets[index],
                    version: "test-build",
                    sha256: await sha256File(paths[index]),
                }),
            );
        }
        await prepareDevelopmentArtifacts(paths[0], paths[1], paths[2], output);
        assertEquals(
            (await verifyBuildArtifact(join(output, "wld-aarch64-unknown-linux-gnu"))).buildId,
            "a".repeat(64),
        );
        await Deno.writeTextFile(paths[1], "corrupted");
        await assertRejects(
            () => prepareDevelopmentArtifacts(paths[0], paths[1], paths[2], join(root, "invalid")),
            Error,
            "checksum",
        );
        await Deno.writeTextFile(paths[1], "binary 1");
        const bad = JSON.parse(await Deno.readTextFile(`${paths[2]}.build.json`));
        bad.buildId = "b".repeat(64);
        await Deno.writeTextFile(`${paths[2]}.build.json`, JSON.stringify(bad));
        await assertRejects(
            () => prepareDevelopmentArtifacts(paths[0], paths[1], paths[2], join(root, "invalid")),
            Error,
            "mismatched",
        );
        assertEquals(await Deno.stat(join(root, "invalid")).then(() => true).catch(() => false), false);
        bad.buildId = "a".repeat(64);
        bad.version = "another-release";
        await Deno.writeTextFile(`${paths[2]}.build.json`, JSON.stringify(bad));
        await assertRejects(
            () => prepareDevelopmentArtifacts(paths[0], paths[1], paths[2], join(root, "invalid")),
            Error,
            "VERSION",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
