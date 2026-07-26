import { join } from "@std/path";

/** @typedef {"Darwin" | "Linux"} TestOs */
/** @typedef {"x86_64" | "arm64"} TestArch */
/** @typedef {"wld" | "mnemosyne" | "cymbal" | "snip"} ReleaseBinaryName */
/** @typedef {ReleaseBinaryName | "agent-browser"} BinaryName */

export const VERSIONS = {
    runwield: "v9.9.9",
    mnemosyne: "v0.2.6",
    cymbal: "v0.14.0",
    snip: "v0.22.0",
};

/** @type {BinaryName[]} */
export const BINARY_NAMES = ["wld", "mnemosyne", "cymbal", "agent-browser", "snip"];

/** @type {ReleaseBinaryName[]} */
export const RELEASE_BINARY_NAMES = ["wld", "mnemosyne", "cymbal", "snip"];

/** @type {Array<Exclude<ReleaseBinaryName, "wld">>} */
export const HELPER_NAMES = ["mnemosyne", "cymbal", "snip"];

/**
 * @param {string} path
 * @param {string} body
 */
export async function writeExecutable(path, body) {
    await Deno.writeTextFile(path, body);
    await Deno.chmod(path, 0o755);
}

/**
 * @param {string} root
 * @param {string} binaryName
 * @param {string} [entryName]
 */
export async function makeArchive(root, binaryName, entryName = binaryName) {
    const dir = await Deno.makeTempDir({ dir: root });
    const body = binaryName === "wld"
        ? `#!/usr/bin/env bash
if [[ "$1" == "snip-filters" && "$2" == "install" ]]; then
  printf 'snip=%s\npath=%s\n' "$(command -v snip || true)" "$PATH" >> "\${WLD_FILTER_LOG:?}"
  exit 0
fi
echo wld version
`
        : `#!/usr/bin/env bash\necho ${binaryName} version\n`;
    await writeExecutable(join(dir, entryName), body);
    const archive = join(root, `${binaryName}-${entryName}.tar.gz`);
    const command = new Deno.Command("tar", { args: ["-czf", archive, "-C", dir, entryName] });
    const status = await command.output();
    if (!status.success) throw new Error(`tar failed for ${binaryName}`);
    return archive;
}

/**
 * @param {string} path
 */
export async function sha256(path) {
    const bytes = await Deno.readFile(path);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {TestOs} os
 * @param {TestArch} arch
 */
export function assetNamesFor(os, arch) {
    const helperOs = os === "Darwin" ? "darwin" : "linux";
    const helperArch = arch === "x86_64" ? "amd64" : "arm64";
    const wldArch = arch === "x86_64" ? "x64" : "arm64";
    const cymbalArch = arch === "x86_64" ? "x86_64" : "arm64";
    return {
        wld: `wld-${VERSIONS.runwield}-${helperOs}-${wldArch}.tar.gz`,
        mnemosyne: `mnemosyne_${VERSIONS.mnemosyne.slice(1)}_${helperOs}_${helperArch}.tar.gz`,
        cymbal: `cymbal_${VERSIONS.cymbal}_${helperOs}_${cymbalArch}.tar.gz`,
        snip: `snip_${VERSIONS.snip.slice(1)}_${helperOs}_${helperArch}.tar.gz`,
    };
}

/**
 * @param {{ os?: TestOs, arch?: TestArch, badChecksumFor?: BinaryName, omitChecksumFor?: BinaryName, badDigestFor?: BinaryName, omitDigestFor?: BinaryName, missingAssetFor?: BinaryName, missingExecutableFor?: BinaryName }} [options]
 */
export async function createFixture(options = {}) {
    const root = await Deno.makeTempDir();
    const fixtureDir = join(root, "fixtures");
    const binDir = join(root, "fake-bin");
    const installDir = join(root, "install dir with spaces");
    const curlLog = join(root, "curl.log");
    const os = options.os ?? "Linux";
    const arch = options.arch ?? "x86_64";
    const assets = assetNamesFor(os, arch);
    await Deno.mkdir(fixtureDir);
    await Deno.mkdir(binDir);
    await Deno.mkdir(installDir);

    /** @type {Record<ReleaseBinaryName, string>} */
    const archivePaths = /** @type {Record<ReleaseBinaryName, string>} */ ({});
    for (const name of RELEASE_BINARY_NAMES) {
        const entryName = options.missingExecutableFor === name ? `${name}-wrong` : name;
        archivePaths[name] = await makeArchive(root, name, entryName);
        if (options.missingAssetFor !== name) {
            await Deno.copyFile(archivePaths[name], join(fixtureDir, assets[name]));
        }
    }

    /** @type {Partial<Record<BinaryName, string>>} */
    const digests = {};
    for (const name of RELEASE_BINARY_NAMES) {
        if (options.missingAssetFor === name) continue;
        digests[name] = options.badDigestFor === name ? "0".repeat(64) : await sha256(join(fixtureDir, assets[name]));
    }

    /** @type {string[]} */
    const wldSums = [];
    /** @type {string[]} */
    const helperSums = [];
    for (const name of RELEASE_BINARY_NAMES) {
        if (options.missingAssetFor === name || options.omitChecksumFor === name) continue;
        const checksum = options.badChecksumFor === name ? "0".repeat(64) : digests[name];
        const line = `${checksum}  ${assets[name]}`;
        if (name === "wld") wldSums.push(line);
        else helperSums.push(line);
    }
    await Deno.writeTextFile(join(fixtureDir, "SHA256SUMS"), `${wldSums.join("\n")}\n`);
    await Deno.writeTextFile(join(fixtureDir, "checksums.txt"), `${helperSums.join("\n")}\n`);

    for (const name of HELPER_NAMES) {
        const assetDigest = options.omitDigestFor === name || !digests[name] ? null : `sha256:${digests[name]}`;
        await Deno.writeTextFile(
            join(fixtureDir, `${name}-release.json`),
            JSON.stringify({ assets: assetDigest ? [{ name: assets[name], digest: assetDigest }] : [] }, null, 2),
        );
    }

    await writeExecutable(
        join(binDir, "curl"),
        `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> '${curlLog}'
case "$url" in
  *gandazgul/runwield*/releases/latest*) body='{"tag_name":"${VERSIONS.runwield}"}' ;;
  *gandazgul/mnemosyne*/releases/latest*) body='{"tag_name":"${VERSIONS.mnemosyne}"}' ;;
  *1broseidon/cymbal*/releases/latest*) body='{"tag_name":"${VERSIONS.cymbal}"}' ;;
  *edouard-claude/snip*/releases/latest*) body='{"tag_name":"${VERSIONS.snip}"}' ;;
  *gandazgul/mnemosyne*/releases/tags/*) file='${join(fixtureDir, "mnemosyne-release.json")}' ;;
  *1broseidon/cymbal*/releases/tags/*) file='${join(fixtureDir, "cymbal-release.json")}' ;;
  *edouard-claude/snip*/releases/tags/*) file='${join(fixtureDir, "snip-release.json")}' ;;
  */SHA256SUMS) file='${join(fixtureDir, "SHA256SUMS")}' ;;
  */checksums.txt) file='${join(fixtureDir, "checksums.txt")}' ;;
  *) file='${fixtureDir}'/"$(basename "$url")" ;;
esac
if [[ -n "\${body:-}" ]]; then
  if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
else
  if [[ ! -f "$file" ]]; then echo "missing fixture $url" >&2; exit 22; fi
  if [[ -n "$out" ]]; then cp "$file" "$out"; else cat "$file"; fi
fi
`,
    );

    await writeExecutable(
        join(binDir, "npm"),
        `#!/usr/bin/env bash
set -euo pipefail
prefix=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -z "$prefix" ]]; then
  echo "missing npm prefix" >&2
  exit 1
fi
mkdir -p "$prefix/bin"
cat >"$prefix/bin/agent-browser" <<'NPMEOF'
#!/usr/bin/env bash
echo agent-browser version
NPMEOF
chmod 755 "$prefix/bin/agent-browser"
`,
    );

    return { root, fixtureDir, binDir, installDir, curlLog, os, arch, assets };
}

/**
 * @param {Awaited<ReturnType<typeof createFixture>>} fixture
 * @param {{ extraPathDir?: string, requestedVersion?: string, noninteractive?: boolean, extraEnv?: Record<string, string> }} [options]
 */
export async function runInstaller(fixture, options = {}) {
    const pathPrefix = options.extraPathDir ? `${options.extraPathDir}:` : "";
    /** @type {Record<string, string>} */
    const env = {
        ...Deno.env.toObject(),
        PATH: `${pathPrefix}${fixture.binDir}:/usr/bin:/bin`,
        HOME: fixture.root,
        WLD_INSTALL_DIR: fixture.installDir,
        WLD_TEST_UNAME_S: fixture.os,
        WLD_TEST_UNAME_M: fixture.arch,
        ...options.extraEnv,
    };
    if (options.noninteractive !== false) env.WLD_NONINTERACTIVE = "1";
    const command = new Deno.Command("/bin/bash", {
        args: ["install.sh", options.requestedVersion ?? VERSIONS.runwield],
        env,
        stdout: "piped",
        stderr: "piped",
    });
    const output = await command.output();
    return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
    };
}

/**
 * @param {Awaited<ReturnType<typeof createFixture>>} fixture
 * @param {string} input
 * @param {{ extraEnv?: Record<string, string> }} [options]
 */
export async function runInstallerInPseudoTty(fixture, input, options = {}) {
    const scriptPath = new URL("../install.sh", import.meta.url).pathname;
    const command = `PATH=${quoteShell(`${fixture.binDir}:/usr/bin:/bin`)} HOME=${
        quoteShell(fixture.root)
    } WLD_INSTALL_DIR=${quoteShell(fixture.installDir)} WLD_TEST_UNAME_S=${quoteShell(fixture.os)} WLD_TEST_UNAME_M=${
        quoteShell(fixture.arch)
    } ${
        Object.entries(options.extraEnv ?? {}).map(([key, value]) => `${key}=${quoteShell(value)}`).join(" ")
    } /bin/bash ${quoteShell(scriptPath)} ${quoteShell(VERSIONS.runwield)}`;
    const proc = new Deno.Command("script", {
        args: ["-q", "/dev/null", "/bin/bash", "-lc", command],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    const output = await proc.output();
    return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
    };
}

/**
 * @param {string} value
 */
function quoteShell(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * @param {string} curlLog
 */
export async function readCurlLog(curlLog) {
    try {
        return await Deno.readTextFile(curlLog);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return "";
        throw error;
    }
}
