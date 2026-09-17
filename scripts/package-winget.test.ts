import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { packageWinget } from "./package-winget.js";
import { sha256 } from "./package-windows.js";

async function run(command: string, args: string[], cwd?: string): Promise<void> {
    const result = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "piped" }).output();
    const decoder = new TextDecoder();
    assertEquals(result.code, 0, `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`);
}

async function makeReleaseZip(root: string, tag = "v1.2.3") {
    const dir = join(root, "zip-root");
    await Deno.mkdir(join(dir, "runtime", "helpers"), { recursive: true });
    await Deno.mkdir(join(dir, "licenses"), { recursive: true });
    await Deno.writeTextFile(join(dir, "wld.exe"), `runwield ${tag} binary`);
    await Deno.writeTextFile(
        join(dir, "runwield-install.json"),
        JSON.stringify({
            schemaVersion: 1,
            packageManager: "winget",
            packageIdentifier: "Gandazgul.RunWield",
            updateCommand: "winget upgrade --id Gandazgul.RunWield --exact",
            repairCommand: "winget repair --id Gandazgul.RunWield --exact",
            installDirectory: ".",
            version: tag,
        }),
    );
    for (const helper of ["mnemoteca", "cymbal", "ketch", "agent-browser"]) {
        await Deno.writeTextFile(join(dir, "runtime", "helpers", `${helper}.exe`), `${helper} helper`);
        await Deno.writeTextFile(join(dir, "licenses", `${helper}-LICENSE.txt`), `${helper} license`);
    }
    await Deno.writeTextFile(join(dir, "licenses", "RUNWIELD-LICENSE.txt"), "runwield license");
    const zip = join(root, `wld-${tag}-windows-x64.zip`);
    await run("zip", ["-qr", zip, "."], dir);
    const checksum = await sha256(await Deno.readFile(zip));
    await Deno.writeTextFile(`${zip}.sha256`, `${checksum}  wld-${tag}-windows-x64.zip\n`);
    return zip;
}

function serve(root: string) {
    const abort = new AbortController();
    const server = Deno.serve(
        { port: 0, hostname: "127.0.0.1", signal: abort.signal, onListen() {} },
        async (request) => {
            const path = new URL(request.url).pathname.slice(1);
            try {
                return new Response(await Deno.readFile(join(root, path)));
            } catch {
                return new Response("not found", { status: 404 });
            }
        },
    );
    return {
        baseUrl: `http://127.0.0.1:${server.addr.port}`,
        close: async () => {
            abort.abort();
            await server.finished.catch(() => {});
        },
    };
}

Deno.test("package:winget renders standard manifests from published ZIP bytes", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-winget-test-" });
    const server = serve(root);
    try {
        await makeReleaseZip(root);
        const output = join(root, "out");
        await packageWinget({ tag: "v1.2.3", output, baseUrl: server.baseUrl, testOnly: true });
        const manifestDir = join(output, "Gandazgul.RunWield", "1.2.3");
        const version = await Deno.readTextFile(join(manifestDir, "Gandazgul.RunWield.yaml"));
        const installer = await Deno.readTextFile(join(manifestDir, "Gandazgul.RunWield.installer.yaml"));
        const locale = await Deno.readTextFile(join(manifestDir, "Gandazgul.RunWield.locale.en-US.yaml"));
        assertStringIncludes(version, "$schema=https://aka.ms/winget-manifest.version.1.10.0.schema.json");
        assertStringIncludes(installer, "$schema=https://aka.ms/winget-manifest.installer.1.10.0.schema.json");
        assertStringIncludes(locale, "$schema=https://aka.ms/winget-manifest.defaultLocale.1.10.0.schema.json");
        assertStringIncludes(installer, "InstallerType: zip");
        assertStringIncludes(installer, "NestedInstallerType: portable");
        assertStringIncludes(installer, "ArchiveBinariesDependOnPath: true");
        assertStringIncludes(installer, "PortableCommandAlias: wld");
        assertStringIncludes(installer, "PackageIdentifier: Git.Git");
        assertStringIncludes(locale, "License: Free Use License");
        const summary = JSON.parse(await Deno.readTextFile(join(output, "runwield-winget-package.json")));
        assertEquals(summary.packageIdentifier, "Gandazgul.RunWield");
    } finally {
        await server.close();
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("package:winget rejects RC tags", async () => {
    await assertRejects(
        () => packageWinget({ tag: "v1.2.3-rc.1", output: "out", baseUrl: "http://127.0.0.1", testOnly: true }),
        Error,
        "Stable tag",
    );
});

Deno.test("package:winget rejects ZIPs with incomplete package metadata", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-winget-bad-metadata-" });
    const server = serve(root);
    try {
        const zip = await makeReleaseZip(root);
        const work = join(root, "rewrite");
        await Deno.mkdir(work, { recursive: true });
        await run("unzip", ["-q", zip, "-d", work]);
        await Deno.writeTextFile(
            join(work, "runwield-install.json"),
            JSON.stringify({ packageManager: "winget", packageIdentifier: "Gandazgul.RunWield", version: "v1.2.3" }),
        );
        await Deno.remove(zip);
        await run("zip", ["-qr", zip, "."], work);
        const checksum = await sha256(await Deno.readFile(zip));
        await Deno.writeTextFile(`${zip}.sha256`, `${checksum}  wld-v1.2.3-windows-x64.zip\n`);
        await assertRejects(
            () => packageWinget({ tag: "v1.2.3", output: join(root, "out"), baseUrl: server.baseUrl, testOnly: true }),
            Error,
            "invalid schemaVersion",
        );
    } finally {
        await server.close();
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("package:winget rejects releases without the Windows ZIP", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-winget-missing-" });
    const server = serve(root);
    try {
        await assertRejects(
            () => packageWinget({ tag: "v1.2.3", output: join(root, "out"), baseUrl: server.baseUrl, testOnly: true }),
            Error,
            "Download failed 404",
        );
    } finally {
        await server.close();
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("package:winget rejects ZIPs without package metadata", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-winget-incomplete-" });
    const server = serve(root);
    try {
        const dir = join(root, "zip-root");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(join(dir, "wld.exe"), "binary");
        const zip = join(root, "wld-v1.2.3-windows-x64.zip");
        await run("zip", ["-qr", zip, "."], dir);
        const checksum = await sha256(await Deno.readFile(zip));
        await Deno.writeTextFile(`${zip}.sha256`, `${checksum}  wld-v1.2.3-windows-x64.zip\n`);
        await assertRejects(
            () => packageWinget({ tag: "v1.2.3", output: join(root, "out"), baseUrl: server.baseUrl, testOnly: true }),
            Error,
            "missing runwield-install.json",
        );
    } finally {
        await server.close();
        await Deno.remove(root, { recursive: true });
    }
});
