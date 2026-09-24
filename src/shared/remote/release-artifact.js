import { join } from "@std/path";
import { sha256Bytes, verifyBuildArtifact } from "../../../scripts/build-metadata.js";

/** @typedef {{buildId: string, protocol: number, version: string}} LauncherIdentity */
/** @type {Record<string, string>} */
const TARGETS = {
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
};
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

/** @param {string} tag @param {string} suffix */
export function releaseRuntimeName(tag, suffix) {
    if (!RELEASE_TAG.test(tag) || (tag.includes("-rc.") && Number(tag.split("-rc.")[1]) < 1)) {
        throw new Error(`Invalid launcher release tag: ${tag}`);
    }
    if (!TARGETS[suffix]) throw new Error(`Unsupported release runtime: ${suffix}`);
    return `wld-${tag}-${suffix}.tar.gz`;
}

/** @param {string[]} args */
async function tar(args) {
    const result = await new Deno.Command("tar", { args, stdout: "piped", stderr: "piped" }).output();
    if (!result.success) throw new Error(`Invalid release archive: ${new TextDecoder().decode(result.stderr).trim()}`);
    return result.stdout;
}

/**
 * Verify archive contents, binary checksum and the matching launcher identity.
 * Never extract arbitrary archive paths to disk.
 * @param {string} archive
 * @param {string} suffix
 * @param {LauncherIdentity | null} launcher
 * @param {string} directory
 */
export async function extractReleaseRuntime(archive, suffix, launcher, directory) {
    const target = TARGETS[suffix];
    if (!target) throw new Error(`Unsupported release runtime: ${suffix}`);
    const entries = new TextDecoder().decode(await tar(["-tzf", archive])).trim().split(/\r?\n/);
    if (entries.length !== 2 || entries[0] !== "wld" || entries[1] !== "wld.build.json") {
        throw new Error(`Release archive must contain only wld and wld.build.json: ${archive}`);
    }
    const artifact = join(directory, "wld");
    await Deno.writeFile(artifact, await tar(["-xOzf", archive, "wld"]));
    await Deno.writeFile(`${artifact}.build.json`, await tar(["-xOzf", archive, "wld.build.json"]));
    const metadata = await verifyBuildArtifact(artifact);
    if (
        metadata.target !== target || (launcher &&
            (metadata.buildId !== launcher.buildId || metadata.protocol !== launcher.protocol ||
                metadata.version !== launcher.version))
    ) {
        throw new Error(`Release runtime does not match launcher build, protocol, VERSION or ${target} target`);
    }
    if (Deno.build.os !== "windows") await Deno.chmod(artifact, 0o700);
    return { artifact, metadata };
}

/**
 * Download only the exact VERSION-tagged asset and its own checksum.
 * @param {string} tag
 * @param {string} suffix
 * @param {LauncherIdentity} launcher
 * @param {AbortSignal} [signal]
 */
export async function downloadReleaseRuntime(tag, suffix, launcher, signal) {
    const name = releaseRuntimeName(tag, suffix);
    const base = `https://github.com/gandazgul/runwield/releases/download/${tag}/${name}`;
    /** @param {string} url */
    async function download(url) {
        let response;
        try {
            response = await fetch(url, {
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
            });
        } catch (error) {
            throw new Error(`Cannot download ${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) throw new Error(`Cannot download ${url}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    const [archiveBytes, checksumBytes] = await Promise.all([download(base), download(`${base}.sha256`)]);
    const checksum = new TextDecoder().decode(checksumBytes).trim();
    if (checksum !== `${await sha256Bytes(archiveBytes)}  ${name}`) {
        throw new Error(`Release archive checksum mismatch: ${name}`);
    }
    const directory = await Deno.makeTempDir({ prefix: "wld-remote-release-" });
    try {
        const archive = join(directory, name);
        await Deno.writeFile(archive, archiveBytes);
        const result = await extractReleaseRuntime(archive, suffix, launcher, directory);
        return { ...result, directory };
    } catch (error) {
        await Deno.remove(directory, { recursive: true });
        throw error;
    }
}
