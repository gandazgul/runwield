/** Stage one checked, flat release asset set. Never change published bytes. */
import { join } from "@std/path";
import { expectedReleaseAssetNames } from "./release.js";

/**
 * @typedef {Object} PublishedAsset
 * @property {string} name
 * @property {string | null} digest
 * @typedef {Object} PublishedRelease
 * @property {PublishedAsset[]} assets
 */

/** @param {string} tag */
export function releaseAssetNames(tag) {
    return [
        ...expectedReleaseAssetNames(tag),
        `wld-${tag}-windows-x64.zip`,
        `wld-${tag}-windows-x64.zip.sha256`,
        "runwield-windows-package.json",
    ];
}

/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
    const result = [];
    for await (const entry of Deno.readDir(directory)) {
        const path = join(directory, entry.name);
        if (entry.isDirectory) result.push(...await files(path));
        else if (entry.isFile) result.push(path);
        else throw new Error(`Unsupported release asset: ${path}`);
    }
    return result;
}

/** @param {string} path */
async function sha256(path) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(path))))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} tag
 * @param {boolean} published
 * @param {string} publishedMetadata
 */
export async function prepareReleaseAssets(input, output, tag, published = false, publishedMetadata = "") {
    if (published && !publishedMetadata) throw new Error("Published recovery requires GitHub asset digests");
    const names = releaseAssetNames(tag);
    const paths = await files(input);
    const selected = new Map();
    for (const name of names) {
        if (name === "SHA256SUMS" && !published) continue;
        const matches = paths.filter((path) => path.split(/[\\/]/).pop() === name);
        if (matches.length !== 1) throw new Error(`Expected one ${name}; found ${matches.length}`);
        selected.set(name, matches[0]);
    }
    const sums = [];
    for (const name of names.filter((name) => name.endsWith(".sha256"))) {
        const asset = name.slice(0, -7);
        const expected = `${await sha256(selected.get(asset))}  ${asset}`;
        const actual = (await Deno.readTextFile(selected.get(name))).trim().replace(/\s+/, "  ");
        if (actual !== expected) throw new Error(`Release checksum mismatch: ${name}`);
        sums.push(expected);
    }
    if (published) {
        const actual = (await Deno.readTextFile(selected.get("SHA256SUMS"))).trim().split(/\r?\n/)
            .map((line) => line.replace(/\s+/, "  ")).sort();
        if (JSON.stringify(actual) !== JSON.stringify([...sums].sort())) {
            throw new Error("Published SHA256SUMS does not match the complete release set");
        }
    }
    if (publishedMetadata) {
        /** @type {PublishedRelease} */
        const metadata = JSON.parse(await Deno.readTextFile(publishedMetadata));
        for (const [name, path] of selected) {
            const asset = metadata.assets.find((asset) => asset.name === name);
            if (asset?.digest !== `sha256:${await sha256(path)}`) {
                throw new Error(`Published asset digest missing or mismatched: ${name}`);
            }
        }
    }
    await Deno.mkdir(output);
    for (const [name, path] of selected) await Deno.copyFile(path, join(output, name));
    if (!published) await Deno.writeTextFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`);
}

if (import.meta.main) {
    const [input, output, tag, mode, metadata] = Deno.args;
    if (!input || !output || !tag) throw new Error("Usage: release-assets.js <input> <output> <tag> [published]");
    if (mode === "published" && !metadata) throw new Error("Published recovery requires GitHub asset digests");
    await prepareReleaseAssets(input, output, tag, mode === "published", metadata);
}
