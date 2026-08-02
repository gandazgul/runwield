import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname } from "@std/path";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { type InstallerProcessPort, type ProcessExitPort, runUpdateCommand, type UpdateNetworkPort } from "./index.ts";

interface InstallerInvocation {
    script: string;
    scriptPath: string;
    releaseTag: string;
    env: Record<string, string>;
}

interface InstallerFixture {
    invocations: InstallerInvocation[];
    port: InstallerProcessPort;
}

function makeJsonResponse(data: Record<string, string>, status = 200): Response {
    return new Response(JSON.stringify(data), { status });
}

function createNetworkFixture(
    releaseResponse: Response,
    installerResponse = new Response("#!/usr/bin/env bash\n"),
): { port: UpdateNetworkPort; urls: string[] } {
    const urls: string[] = [];
    return {
        urls,
        port: {
            fetch: (input) => {
                const url = String(input);
                urls.push(url);
                return Promise.resolve(
                    url.includes("api.github.com") ? releaseResponse.clone() : installerResponse.clone(),
                );
            },
        },
    };
}

function createInstallerFixture(exitCode = 0): InstallerFixture {
    const invocations: InstallerInvocation[] = [];
    return {
        invocations,
        port: {
            run: async (scriptPath, releaseTag, env) => {
                invocations.push({
                    script: await Deno.readTextFile(scriptPath),
                    scriptPath,
                    releaseTag,
                    env: { ...env },
                });
                return exitCode;
            },
        },
    };
}

function createExitFixture(): { codes: number[]; port: ProcessExitPort } {
    const codes: number[] = [];
    return { codes, port: { exit: (code) => codes.push(code) } };
}

async function captureConsole(run: () => void | Promise<void>): Promise<{ logs: string[]; errors: string[] }> {
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (message = "") => logs.push(String(message));
    console.error = (message = "") => errors.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logs, errors };
}

async function assertRemoved(path: string): Promise<void> {
    await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
}

Deno.test("update downloads the pinned installer, writes a real temp script, executes it, and cleans up", async () => {
    const network = createNetworkFixture(makeJsonResponse({ tag_name: "v999.0.0" }));
    const installer = createInstallerFixture();

    const output = await captureConsole(() =>
        runUpdateCommand([], {
            networkPort: network.port,
            installerPort: installer.port,
        })
    );

    assertEquals(network.urls, [
        "https://api.github.com/repos/gandazgul/runwield/releases/latest",
        "https://raw.githubusercontent.com/gandazgul/runwield/v999.0.0/install.sh",
    ]);
    assertEquals(installer.invocations.length, 1);
    const invocation = installer.invocations[0];
    assertEquals(invocation.script, "#!/usr/bin/env bash\n");
    assertEquals(invocation.releaseTag, "v999.0.0");
    assertStringIncludes(output.logs.join("\n"), "running from source");
    await assertRemoved(dirname(invocation.scriptPath));
});

Deno.test("update passes the real WLD_INSTALL_DIR environment override to the installer", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousInstallDir = Deno.env.get("WLD_INSTALL_DIR");
        Deno.env.set("WLD_INSTALL_DIR", "/fixture/custom/bin");
        const network = createNetworkFixture(makeJsonResponse({ tag_name: "v999.0.0" }));
        const installer = createInstallerFixture();
        try {
            await runUpdateCommand([], {
                networkPort: network.port,
                installerPort: installer.port,
            });
            assertEquals(installer.invocations[0].env.WLD_INSTALL_DIR, "/fixture/custom/bin");
        } finally {
            if (previousInstallDir === undefined) Deno.env.delete("WLD_INSTALL_DIR");
            else Deno.env.set("WLD_INSTALL_DIR", previousInstallDir);
        }
    });
});

Deno.test("update rejects arguments through the real usage formatter before external work", async () => {
    const exits = createExitFixture();
    const output = await captureConsole(() => runUpdateCommand(["extra"], { exitPort: exits.port }));

    assertEquals(output.errors, ["Usage: wld update\n       wld upgrade"]);
    assertEquals(exits.codes, [1]);
});

Deno.test("update cleans its real temp directory before forwarding installer failure", async () => {
    const network = createNetworkFixture(makeJsonResponse({ tag_name: "v999.0.0" }));
    const installer = createInstallerFixture(7);
    const exits = createExitFixture();

    await captureConsole(() =>
        runUpdateCommand([], {
            networkPort: network.port,
            installerPort: installer.port,
            exitPort: exits.port,
        })
    );

    assertEquals(exits.codes, [7]);
    await assertRemoved(dirname(installer.invocations[0].scriptPath));
});

Deno.test("update reports release lookup failures without creating an installer process", async () => {
    const network = createNetworkFixture(makeJsonResponse({}, 500));
    const installer = createInstallerFixture();
    const exits = createExitFixture();

    const output = await captureConsole(() =>
        runUpdateCommand([], {
            networkPort: network.port,
            installerPort: installer.port,
            exitPort: exits.port,
        })
    );

    assertEquals(output.errors, ["RunWield update failed: GitHub latest release request failed: 500"]);
    assertEquals(installer.invocations, []);
    assertEquals(exits.codes, [1]);
});
