/**
 * Generate WinGet manifests for a published RunWield Windows ZIP.
 */

import { join } from "@std/path";
import { parseReleaseTag } from "./release.js";
import { sha256 } from "./package-windows.js";

const RUNWIELD_REPO = "gandazgul/runwield";
const PACKAGE_ID = "Gandazgul.RunWield";
const PUBLISHER = "Gandazgul";
const PACKAGE_NAME = "RunWield";

function usage() {
    return "Usage: package-winget.js --tag <stable-tag> --output <dir> [--base-url <release-asset-base-url>] [--test-only]";
}

/** @param {string[]} args */
export function parsePackageWingetArgs(args) {
    const options = { tag: "", output: "", baseUrl: "", testOnly: false };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--tag") options.tag = args[++index] || "";
        else if (arg === "--output") options.output = args[++index] || "";
        else if (arg === "--base-url") options.baseUrl = args[++index] || "";
        else if (arg === "--test-only") options.testOnly = true;
        else throw new Error(`Unknown package:winget option: ${arg}\n${usage()}`);
    }
    if (!options.tag || !options.output) throw new Error(usage());
    if (options.baseUrl && !options.testOnly) throw new Error("Base URL overrides require --test-only.");
    return options;
}

/** @param {string} url */
async function readUrlBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
    return new Uint8Array(await response.arrayBuffer());
}

/** @param {string} tag @param {string} baseUrl */
function assetBaseUrl(tag, baseUrl) {
    return baseUrl || `https://github.com/${RUNWIELD_REPO}/releases/download/${tag}`;
}

/** @param {string} version */
function renderVersionManifest(version) {
    return `# Created by deno task package:winget
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.10.0
`;
}

/** @param {string} version */
function renderLocaleManifest(version) {
    return `# Created by deno task package:winget
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${PUBLISHER}
PublisherUrl: https://github.com/gandazgul
PublisherSupportUrl: https://github.com/gandazgul/runwield/issues
PackageName: ${PACKAGE_NAME}
PackageUrl: https://github.com/gandazgul/runwield
License: Free Use License
LicenseUrl: https://github.com/gandazgul/runwield/blob/v${version}/LICENSE
ShortDescription: Plan-first AI coding harness.
Description: RunWield is a local, plan-first AI coding harness for software projects.
Tags:
- ai
- cli
- coding-agent
- runwield
ManifestType: defaultLocale
ManifestVersion: 1.10.0
`;
}

/** @param {string} version @param {string} url @param {string} checksum */
function renderInstallerManifest(version, url, checksum) {
    return `# Created by deno task package:winget
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: zip
Commands:
- wld
Dependencies:
  PackageDependencies:
  - PackageIdentifier: Git.Git
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${checksum.toUpperCase()}
  NestedInstallerType: portable
  NestedInstallerFiles:
  - RelativeFilePath: wld.exe
    PortableCommandAlias: wld
ManifestType: installer
ManifestVersion: 1.10.0
`;
}

/** @param {Uint8Array} bytes */
function assertZipHasPackageMetadata(bytes) {
    const text = new TextDecoder().decode(bytes);
    if (!text.includes("runwield-install.json") || !text.includes("wld.exe")) {
        throw new Error("Published Windows ZIP is missing package metadata or wld.exe.");
    }
}

/** @param {{ tag: string, output: string, baseUrl: string, testOnly: boolean }} options */
export async function packageWinget(options) {
    const parsed = parseReleaseTag(options.tag);
    if (parsed.kind !== "stable") throw new Error(`WinGet manifests require a Stable tag: ${options.tag}`);
    const version = parsed.tag.slice(1);
    const assetName = `wld-${parsed.tag}-windows-x64.zip`;
    const url = `${assetBaseUrl(parsed.tag, options.baseUrl).replace(/\/$/, "")}/${assetName}`;
    const bytes = await readUrlBytes(url);
    assertZipHasPackageMetadata(bytes);
    const checksum = await sha256(bytes);

    const manifestDir = join(options.output, PACKAGE_ID, version);
    await Deno.remove(manifestDir, { recursive: true }).catch(() => {});
    await Deno.mkdir(manifestDir, { recursive: true });
    await Deno.writeTextFile(join(manifestDir, `${PACKAGE_ID}.yaml`), renderVersionManifest(version));
    await Deno.writeTextFile(join(manifestDir, `${PACKAGE_ID}.locale.en-US.yaml`), renderLocaleManifest(version));
    await Deno.writeTextFile(
        join(manifestDir, `${PACKAGE_ID}.installer.yaml`),
        renderInstallerManifest(version, url, checksum),
    );
    await Deno.writeTextFile(
        join(options.output, "runwield-winget-package.json"),
        `${
            JSON.stringify(
                { tag: parsed.tag, packageIdentifier: PACKAGE_ID, manifestDir, installerUrl: url, sha256: checksum },
                null,
                4,
            )
        }\n`,
    );
}

export async function main(args = Deno.args) {
    await packageWinget(parsePackageWingetArgs(args));
}

if (import.meta.main) await main();
