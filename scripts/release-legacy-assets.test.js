import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { prepareReleaseAssets, releaseAssetNames } from "./release-assets.js";
import { sha256File } from "./build-metadata.js";

Deno.test("published recovery keeps immutable pre-metadata release archives", async () => {
    const root = await Deno.makeTempDir();
    const input = join(root, "published");
    const output = join(root, "recovered");
    const tag = "v0.9.0";
    try {
        await Deno.mkdir(input);
        const sums = [];
        const assets = [];
        for (
            const name of releaseAssetNames(tag).filter((name) => !name.endsWith(".sha256") && name !== "SHA256SUMS")
        ) {
            const path = join(input, name);
            if (name.endsWith(".tar.gz")) {
                const binary = join(root, "wld");
                await Deno.writeTextFile(binary, name);
                const result = await new Deno.Command("tar", { args: ["-czf", path, "-C", root, "wld"] }).output();
                if (!result.success) throw new Error("Could not create legacy archive");
            } else await Deno.writeTextFile(path, name);
            if (releaseAssetNames(tag).includes(`${name}.sha256`)) {
                const sum = `${await sha256File(path)}  ${name}`;
                sums.push(sum);
                await Deno.writeTextFile(`${path}.sha256`, `${sum}\n`);
            }
        }
        await Deno.writeTextFile(join(input, "SHA256SUMS"), `${sums.join("\n")}\n`);
        for (const name of releaseAssetNames(tag)) {
            assets.push({ name, digest: `sha256:${await sha256File(join(input, name))}` });
        }
        const metadata = join(root, "published.json");
        await Deno.writeTextFile(metadata, JSON.stringify({ assets }));
        await prepareReleaseAssets(input, output, tag, true, metadata);
        for (const name of releaseAssetNames(tag)) {
            assertEquals(await Deno.readFile(join(output, name)), await Deno.readFile(join(input, name)));
        }
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
