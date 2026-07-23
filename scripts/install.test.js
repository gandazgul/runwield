import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

/** @typedef {"Darwin" | "Linux"} TestOs */
/** @typedef {"x86_64" | "arm64"} TestArch */
/** @typedef {"wld" | "mnemosyne" | "cymbal" | "snip"} BinaryName */

const VERSIONS = {
    runwield: "v9.9.9",
    mnemosyne: "v0.2.6",
    cymbal: "v0.14.0",
    snip: "v0.22.0",
};

/** @type {BinaryName[]} */
const BINARY_NAMES = ["wld", "mnemosyne", "cymbal", "snip"];

/**
 * @param {string} path
 * @param {string} body
 */
async function writeExecutable(path, body) {
    await Deno.writeTextFile(path, body);
    await Deno.chmod(path, 0o755);
}

/**
 * @param {string} root
 * @param {string} binaryName
 * @param {string} [entryName]
 */
async function makeArchive(root, binaryName, entryName = binaryName) {
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
async function sha256(path) {
    const bytes = await Deno.readFile(path);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {TestOs} os
 * @param {TestArch} arch
 */
function assetNamesFor(os, arch) {
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
 * @param {{ os?: TestOs, arch?: TestArch, badChecksumFor?: BinaryName, omitChecksumFor?: BinaryName, missingAssetFor?: BinaryName, missingExecutableFor?: BinaryName }} [options]
 */
async function createFixture(options = {}) {
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

    /** @type {Record<BinaryName, string>} */
    const archivePaths = /** @type {Record<BinaryName, string>} */ ({});
    for (const name of BINARY_NAMES) {
        const entryName = options.missingExecutableFor === name ? `${name}-wrong` : name;
        archivePaths[name] = await makeArchive(root, name, entryName);
        if (options.missingAssetFor !== name) {
            await Deno.copyFile(archivePaths[name], join(fixtureDir, assets[name]));
        }
    }

    /** @type {string[]} */
    const wldSums = [];
    /** @type {string[]} */
    const helperSums = [];
    for (const name of BINARY_NAMES) {
        if (options.missingAssetFor === name || options.omitChecksumFor === name) continue;
        const checksum = options.badChecksumFor === name
            ? "0".repeat(64)
            : await sha256(join(fixtureDir, assets[name]));
        const line = `${checksum}  ${assets[name]}`;
        if (name === "wld") wldSums.push(line);
        else helperSums.push(line);
    }
    await Deno.writeTextFile(join(fixtureDir, "SHA256SUMS"), `${wldSums.join("\n")}\n`);
    await Deno.writeTextFile(join(fixtureDir, "checksums.txt"), `${helperSums.join("\n")}\n`);

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

    return { root, fixtureDir, binDir, installDir, curlLog, os, arch, assets };
}

/**
 * @param {Awaited<ReturnType<typeof createFixture>>} fixture
 * @param {{ extraPathDir?: string, requestedVersion?: string, noninteractive?: boolean, extraEnv?: Record<string, string> }} [options]
 */
async function runInstaller(fixture, options = {}) {
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
async function runInstallerInPseudoTty(fixture, input, options = {}) {
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
async function readCurlLog(curlLog) {
    try {
        return await Deno.readTextFile(curlLog);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return "";
        throw error;
    }
}

Deno.test("install.sh maps Darwin/Linux amd64/arm64 assets and preserves positional wld version", async (t) => {
    /** @type {Array<{ os: TestOs, arch: TestArch }>} */
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
                for (const name of BINARY_NAMES) {
                    assertStringIncludes(curlLog, fixture.assets[name]);
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
        assertStringIncludes(first.stdout, "Installed helpers: snip");

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

Deno.test("install.sh rejects missing or corrupt checksum entries", async (t) => {
    await t.step("missing checksum entry", async () => {
        const fixture = await createFixture({ omitChecksumFor: "cymbal" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum manifest lacks an entry for cymbal");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("corrupt checksum", async () => {
        const fixture = await createFixture({ badChecksumFor: "mnemosyne" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum verification failed for mnemosyne");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh rejects missing executables in required helper archives", async () => {
    const fixture = await createFixture({ missingExecutableFor: "mnemosyne" });
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "does not contain executable 'mnemosyne'");
        assertStringIncludes(result.stderr, "Required helper Mnemosyne could not be installed");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh aborts on required helper download failure but not optional Snip failure", async (t) => {
    await t.step("required Mnemosyne failure", async () => {
        const fixture = await createFixture({ missingAssetFor: "mnemosyne" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Failed to download mnemosyne archive");
            assertStringIncludes(result.stderr, "Required helper Mnemosyne could not be installed");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("optional Snip failure", async () => {
        const fixture = await createFixture({ missingAssetFor: "snip" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
            assertStringIncludes(result.stderr, "Warning: optional helper Snip could not be installed");
            for (const name of ["wld", "mnemosyne", "cymbal"]) {
                const stat = await Deno.stat(join(fixture.installDir, name));
                assertEquals(stat.isFile, true);
            }
            await assertRejects(() => Deno.stat(join(fixture.installDir, "snip")), Deno.errors.NotFound);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh non-interactive mode prints one PATH recommendation without prompts", async () => {
    const fixture = await createFixture();
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        assertStringIncludes(result.stdout, "Restart your shell or run:");
        assertStringIncludes(result.stdout, `export PATH=\"${fixture.installDir}:$PATH\"`);
        assertEquals(result.stdout.includes("Add " + fixture.installDir + " to your PATH"), false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh recognizes newly installed Snip for filter setup before shell reload", async () => {
    const fixture = await createFixture();
    const filterLog = join(fixture.root, "filter.log");
    try {
        const result = await runInstallerInPseudoTty(fixture, "n\n\n", { extraEnv: { WLD_FILTER_LOG: filterLog } });
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        assertStringIncludes(result.stdout, "RunWield Deno Snip filters installed");
        const log = await Deno.readTextFile(filterLog);
        assertStringIncludes(log, `snip=${join(fixture.installDir, "snip")}`);
        assertStringIncludes(log, `path=${fixture.installDir}:`);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});
