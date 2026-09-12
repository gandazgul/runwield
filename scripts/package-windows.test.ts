import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { packageWindows, sha256 } from "./package-windows.js";

async function run(command: string, args: string[], cwd?: string): Promise<string> {
    const result = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "piped" }).output();
    const decoder = new TextDecoder();
    const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;
    assertEquals(result.code, 0, output);
    return output;
}

async function makeZip(root: string, name: string, entryName: string): Promise<{ url: string; sha256: string }> {
    const dir = join(root, `${name}-dir`);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, entryName), `${name} executable`);
    const zip = join(root, `${name}.zip`);
    await run("zip", ["-qr", zip, "."], dir);
    const bytes = await Deno.readFile(zip);
    return { url: new URL(zip, "file://").href, sha256: await sha256(bytes) };
}

async function makeFixture() {
    const root = await Deno.makeTempDir({ prefix: "runwield-windows-package-test-" });
    const binary = join(root, "wld.exe");
    await Deno.writeTextFile(binary, "runwield windows binary");
    const mnemoteca = await makeZip(root, "mnemoteca", "mnemoteca.exe");
    const cymbal = await makeZip(root, "cymbal", "cymbal.exe");
    const ketch = await makeZip(root, "ketch", "ketch.exe");
    const agentBrowser = join(root, "agent-browser.exe");
    await Deno.writeTextFile(agentBrowser, "agent browser exe");
    const agentBrowserBytes = await Deno.readFile(agentBrowser);
    const inputsPath = join(root, "inputs.json");
    await Deno.writeTextFile(
        inputsPath,
        JSON.stringify({
            packageIdentifier: "Gandazgul.RunWield",
            helpers: [
                {
                    name: "mnemoteca",
                    version: "v1",
                    ...mnemoteca,
                    license: "MIT",
                    licenseUrl: "https://example.test/m",
                    requiredFiles: ["mnemoteca.exe"],
                },
                {
                    name: "cymbal",
                    version: "v1",
                    ...cymbal,
                    license: "MIT",
                    licenseUrl: "https://example.test/c",
                    requiredFiles: ["cymbal.exe"],
                },
                {
                    name: "ketch",
                    version: "v1",
                    ...ketch,
                    license: "MIT",
                    licenseUrl: "https://example.test/k",
                    requiredFiles: ["ketch.exe"],
                },
                {
                    name: "agent-browser",
                    version: "v1",
                    url: new URL(agentBrowser, "file://").href,
                    sha256: await sha256(agentBrowserBytes),
                    license: "Apache-2.0",
                    licenseUrl: "https://example.test/a",
                    requiredFiles: ["agent-browser.exe"],
                },
            ],
        }),
    );
    return { root, binary, inputsPath, close: () => Deno.remove(root, { recursive: true }) };
}

Deno.test("package:windows creates a complete ZIP with helpers, notices and metadata", async () => {
    const fixture = await makeFixture();
    try {
        const output = join(fixture.root, "out");
        await packageWindows({ tag: "v1.2.3", binary: fixture.binary, output, inputsPath: fixture.inputsPath });
        const zipPath = join(output, "wld-v1.2.3-windows-x64.zip");
        const listing = await run("unzip", ["-l", zipPath]);
        assertStringIncludes(listing, "wld.exe");
        assertStringIncludes(listing, "runwield-install.json");
        assertStringIncludes(listing, "runtime/helpers/mnemoteca.exe");
        assertStringIncludes(listing, "runtime/helpers/agent-browser.exe");
        assertStringIncludes(listing, "licenses/RUNWIELD-LICENSE.txt");
        const checksum = await Deno.readTextFile(`${zipPath}.sha256`);
        assertStringIncludes(checksum, "wld-v1.2.3-windows-x64.zip");
    } finally {
        await fixture.close();
    }
});

Deno.test("package:windows rejects corrupt helper bytes", async () => {
    const fixture = await makeFixture();
    try {
        const inputs = JSON.parse(await Deno.readTextFile(fixture.inputsPath));
        inputs.helpers[0].sha256 = "0".repeat(64);
        await Deno.writeTextFile(fixture.inputsPath, JSON.stringify(inputs));
        await assertRejects(
            () =>
                packageWindows({
                    tag: "v1.2.3",
                    binary: fixture.binary,
                    output: join(fixture.root, "out"),
                    inputsPath: fixture.inputsPath,
                }),
            Error,
            "Checksum mismatch",
        );
    } finally {
        await fixture.close();
    }
});

Deno.test("package:windows rejects missing required helper files", async () => {
    const fixture = await makeFixture();
    try {
        const inputs = JSON.parse(await Deno.readTextFile(fixture.inputsPath));
        inputs.helpers[1].requiredFiles = ["missing.exe"];
        await Deno.writeTextFile(fixture.inputsPath, JSON.stringify(inputs));
        await assertRejects(
            () =>
                packageWindows({
                    tag: "v1.2.3",
                    binary: fixture.binary,
                    output: join(fixture.root, "out"),
                    inputsPath: fixture.inputsPath,
                }),
            Error,
            "missing.exe",
        );
    } finally {
        await fixture.close();
    }
});
