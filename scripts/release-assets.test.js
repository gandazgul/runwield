import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { prepareReleaseAssets, releaseAssetNames } from "./release-assets.js";

async function fixture() {
    const root = await Deno.makeTempDir();
    const input = join(root, "input");
    await Deno.mkdir(input);
    const tag = "v1.2.3";
    const names = releaseAssetNames(tag);
    for (const name of names.filter((name) => !name.endsWith(".sha256") && name !== "SHA256SUMS")) {
        if (/-(darwin-(arm64|x64)|linux-(arm64|x64))\.tar\.gz$/.test(name)) {
            const suffix = name.slice(`wld-${tag}-`.length, -".tar.gz".length);
            const target = {
                "darwin-arm64": "aarch64-apple-darwin",
                "darwin-x64": "x86_64-apple-darwin",
                "linux-arm64": "aarch64-unknown-linux-gnu",
                "linux-x64": "x86_64-unknown-linux-gnu",
            }[suffix];
            const stage = join(root, `stage-${suffix}`);
            await Deno.mkdir(stage);
            const binary = new TextEncoder().encode(name);
            await Deno.writeFile(join(stage, "wld"), binary);
            const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", binary)))
                .map((byte) => byte.toString(16).padStart(2, "0")).join("");
            await Deno.writeTextFile(
                join(stage, "wld.build.json"),
                JSON.stringify({
                    schema: 1,
                    protocol: 1,
                    buildId: "a".repeat(64),
                    target,
                    version: "v1.2.3",
                    sha256,
                }),
            );
            const result = await new Deno.Command("tar", {
                args: ["-czf", join(input, name), "-C", stage, "wld", "wld.build.json"],
            }).output();
            if (!result.success) throw new Error("Could not create test archive");
        } else await Deno.writeTextFile(join(input, name), name);
        const bytes = await Deno.readFile(join(input, name));
        if (names.includes(`${name}.sha256`)) {
            const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
                .map((byte) => byte.toString(16).padStart(2, "0")).join("");
            await Deno.writeTextFile(join(input, `${name}.sha256`), `${digest}  ${name}\n`);
        }
    }
    return { root, input, tag, output: join(root, "output") };
}

Deno.test("release assets exclude incidental package JSON and produce a unique flat set", async () => {
    const f = await fixture();
    try {
        await Deno.mkdir(join(f.input, "other"));
        await Deno.writeTextFile(join(f.input, "package.json"), "{}");
        await Deno.writeTextFile(join(f.input, "other/package.json"), "{}");
        await prepareReleaseAssets(f.input, f.output, f.tag);
        const names = Array.fromAsync(Deno.readDir(f.output), (entry) => entry.name);
        assertEquals((await names).sort(), releaseAssetNames(f.tag).sort());
    } finally {
        await Deno.remove(f.root, { recursive: true });
    }
});

for (const failure of ["duplicate", "missing", "corrupt", "unsafe checksum", "published checksum"]) {
    Deno.test(`release assets reject ${failure} before staging publication`, async () => {
        const f = await fixture();
        try {
            const name = `wld-${f.tag}-darwin-arm64.tar.gz`;
            if (failure === "duplicate") {
                await Deno.mkdir(join(f.input, "other"));
                await Deno.copyFile(join(f.input, name), join(f.input, "other", name));
            } else if (failure === "missing") await Deno.remove(join(f.input, name));
            else if (failure === "corrupt") await Deno.writeTextFile(join(f.input, name), "changed");
            else if (failure === "unsafe checksum") {
                await Deno.writeTextFile(join(f.input, `${name}.sha256`), `${"a".repeat(64)}  ../escape\n`);
            } else await Deno.writeTextFile(join(f.input, "SHA256SUMS"), `${"a".repeat(64)}  ${name}\n`);
            await assertRejects(
                () => prepareReleaseAssets(f.input, f.output, f.tag, failure === "published checksum", "unused.json"),
                Error,
                failure === "published checksum" ? "Published SHA256SUMS" : "",
            );
            assertEquals(await Deno.stat(f.output).then(() => true).catch(() => false), false);
        } finally {
            await Deno.remove(f.root, { recursive: true });
        }
    });
}

for (const corruptMetadata of [false, true]) {
    Deno.test(`published release recovery ${corruptMetadata ? "rejects a changed schema" : "preserves every checked byte"}`, async () => {
        const f = await fixture();
        try {
            await prepareReleaseAssets(f.input, f.output, f.tag);
            const assets = [];
            for (const name of releaseAssetNames(f.tag)) {
                const bytes = await Deno.readFile(join(f.output, name));
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
                    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
                assets.push({ name, digest: `sha256:${digest}` });
            }
            const metadata = join(f.root, "published.json");
            await Deno.writeTextFile(metadata, JSON.stringify({ assets }));
            const recovered = join(f.root, "recovered");
            if (corruptMetadata) {
                await Deno.writeTextFile(join(f.output, "config.schema.json"), "changed");
                await assertRejects(
                    () => prepareReleaseAssets(f.output, recovered, f.tag, true, metadata),
                    Error,
                    "digest",
                );
            } else {
                await prepareReleaseAssets(f.output, recovered, f.tag, true, metadata);
                for (const name of releaseAssetNames(f.tag)) {
                    assertEquals(await Deno.readFile(join(recovered, name)), await Deno.readFile(join(f.output, name)));
                }
            }
        } finally {
            await Deno.remove(f.root, { recursive: true });
        }
    });
}

for (const field of ["buildId", "version"]) {
    Deno.test(`release publication rejects a GNU runtime with a different launcher ${field}`, async () => {
        const f = await fixture();
        try {
            const name = `wld-${f.tag}-linux-x64.tar.gz`;
            const stage = join(f.root, "stage-linux-x64");
            const metadataPath = join(stage, "wld.build.json");
            const metadata = JSON.parse(await Deno.readTextFile(metadataPath));
            metadata[field] = field === "buildId" ? "b".repeat(64) : "v9.8.7";
            await Deno.writeTextFile(metadataPath, JSON.stringify(metadata));
            const result = await new Deno.Command("tar", {
                args: ["-czf", join(f.input, name), "-C", stage, "wld", "wld.build.json"],
            }).output();
            if (!result.success) throw new Error("Could not create test archive");
            const digest = Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(join(f.input, name)))),
            )
                .map((byte) => byte.toString(16).padStart(2, "0")).join("");
            await Deno.writeTextFile(join(f.input, `${name}.sha256`), `${digest}  ${name}\n`);
            await assertRejects(() => prepareReleaseAssets(f.input, f.output, f.tag), Error, "does not match launcher");
        } finally {
            await Deno.remove(f.root, { recursive: true });
        }
    });
}

Deno.test("published release recovery requires independent asset digests", async () => {
    const f = await fixture();
    try {
        await prepareReleaseAssets(f.input, f.output, f.tag);
        await assertRejects(
            () => prepareReleaseAssets(f.output, join(f.root, "recovered"), f.tag, true),
            Error,
            "requires GitHub asset digests",
        );
    } finally {
        await Deno.remove(f.root, { recursive: true });
    }
});
