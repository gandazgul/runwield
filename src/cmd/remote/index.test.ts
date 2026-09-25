import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { parseRemoteDestination } from "./index.ts";

const cli = fromFileUrl(new URL("../../cli.ts", import.meta.url));
const decoder = new TextDecoder();

interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface RemoteFixture {
    local: string;
    remote: string;
    sshLog: string;
    run: (args: string[], proof?: string) => Promise<CliResult>;
}

/** Run the real CLI with a disposable home and an SSH executable that runs the remote command in a shell. */
async function withRemoteFixture(test: (fixture: RemoteFixture) => Promise<void>): Promise<void> {
    const root = await Deno.realPath(await Deno.makeTempDir());
    try {
        const local = join(root, "local");
        const remote = join(root, "remote-home");
        const bin = join(root, "bin");
        const sshLog = join(root, "ssh-args");
        await Promise.all([Deno.mkdir(local), Deno.mkdir(remote), Deno.mkdir(bin)]);
        // Only this SSH subprocess sees a Linux host. The resolver itself still
        // runs unchanged through the actual shell and Python interpreter.
        await Deno.writeTextFile(
            join(root, "sitecustomize.py"),
            'import platform\nplatform.system = lambda: "Linux"\nplatform.machine = lambda: "x86_64"\n',
        );
        await Deno.writeTextFile(
            join(bin, "ssh"),
            `#!/bin/sh
printf '%s\\n' "$@" > "$SSH_LOG"
[ "$1" = -T ] && [ "$2" = -- ] && [ "$#" = 4 ] || exit 42
HOME="$REMOTE_HOME" PYTHONPATH="$REMOTE_PYTHONPATH" export HOME PYTHONPATH
exec /bin/sh -c "$4"
`,
        );
        await Deno.chmod(join(bin, "ssh"), 0o700);
        await test({
            local,
            remote,
            sshLog,
            run: async (args, proof) => {
                const output = await new Deno.Command(Deno.execPath(), {
                    args: ["run", "-A", "--quiet", cli, "remote", ...args],
                    cwd: local,
                    env: {
                        HOME: local,
                        WLD_TEST_SANDBOX_HOME: local,
                        MNEMOTECA_DB_PATH: join(local, "mnemoteca.db"),
                        PATH: `${bin}:${Deno.env.get("PATH") ?? ""}`,
                        SSH_LOG: sshLog,
                        REMOTE_HOME: remote,
                        REMOTE_PYTHONPATH: root,
                        ...(proof === undefined ? {} : { WLD_REMOTE_MODEL_PROOF: proof }),
                    },
                    stdin: "null",
                    stdout: "piped",
                    stderr: "piped",
                }).output();
                return {
                    code: output.code,
                    stdout: decoder.decode(output.stdout),
                    stderr: decoder.decode(output.stderr),
                };
            },
        });
    } finally {
        await Deno.remove(root, { recursive: true });
    }
}

Deno.test("remote destination separates a directory from an SSH host without changing the host", () => {
    assertEquals(parseRemoteDestination("alias"), { host: "alias", path: null });
    assertEquals(parseRemoteDestination("user@alias:~/repo:branch"), { host: "user@alias", path: "~/repo:branch" });
    assertEquals(parseRemoteDestination("[2001:db8::1]:/srv/repo"), { host: "[2001:db8::1]", path: "/srv/repo" });
    assertEquals(parseRemoteDestination("alias:"), { host: "alias", path: null });
});

Deno.test("remote destination rejects option-like and malformed hosts", () => {
    for (const destination of ["", "-oProxyCommand=bad", "-oBad:/repo", ":/repo", "alias name", "[unfinished"]) {
        assertThrows(() => parseRemoteDestination(destination), Error, "Invalid SSH destination");
    }
});

Deno.test("remote CLI help and invalid arity do not contact SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        const help = await run(["--help"]);
        assertEquals(help.code, 0);
        assertStringIncludes(help.stdout, "Usage: wld remote <ssh-host>");
        const missing = await run([]);
        assertEquals(missing.code, 1);
        assertStringIncludes(missing.stderr, "Usage: wld remote <ssh-host>");
        const excess = await run(["alias", "other"]);
        assertEquals(excess.code, 1);
        assertEquals(await exists(sshLog), false);
    });
});

Deno.test("source remote help works without a generated identity and connection explains the build step", async () => {
    const root = await Deno.makeTempDir();
    try {
        for (const path of ["src/cmd/remote", "src/shared/remote", "scripts"]) {
            await Deno.mkdir(join(root, path), { recursive: true });
        }
        for (
            const path of [
                "src/cmd/remote/index.ts",
                "src/shared/remote/runtime.js",
                "src/shared/remote/target.js",
                "src/shared/remote/control.ts",
                "src/shared/remote/release-artifact.js",
                "src/shared/remote/sftp-mount.ts",
                "src/shared/remote/model-proof-config.ts",
                "src/constants.js",
                "runtime-root.js",
                "scripts/build-metadata.js",
                "src/shared/version.js",
            ]
        ) await Deno.copyFile(path, join(root, path));
        const module = await import(toFileUrl(join(root, "src/cmd/remote/index.ts")).href);
        const originalLog = console.log;
        let help = "";
        try {
            console.log = (message: string) => {
                help = message;
            };
            await module.runRemoteCommand(["--help"]);
        } finally {
            console.log = originalLog;
        }
        assertStringIncludes(help, "Usage: wld remote");
        await assertRejects(() => module.runRemoteCommand(["example"]), Error, "scripts/compile.js --output bin/wld");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("remote CLI refuses malformed LIVE proof before contacting SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        for (
            const proof of [
                "",
                "{}",
                "not-json",
                '{"provider":"p","modelId":"m","sentinelFile":"../secret"}',
                '{"provider":"p","modelId":"m","sentinelFile":"/tmp/secret"}',
            ]
        ) {
            const result = await run(["alias"], proof);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Invalid WLD_REMOTE_MODEL_PROOF");
            assertEquals(await exists(sshLog), false);
        }
    });
});

Deno.test("remote CLI rejects an option-like host before invoking SSH", async () => {
    await withRemoteFixture(async ({ run, sshLog }) => {
        const result = await run(["-oProxyCommand=bad"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Invalid SSH destination");
        assertEquals(await exists(sshLog), false);
    });
});

Deno.test("remote CLI resolves a host home without initializing a local project and requires a built artifact", async () => {
    await withRemoteFixture(async ({ run, local, remote, sshLog }) => {
        const result = await run(["remote-alias"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Missing x86_64-unknown-linux-gnu artifact");
        assertStringIncludes(result.stderr, "scripts/compile.js --target x86_64-unknown-linux-gnu");
        assertEquals((await Deno.readTextFile(sshLog)).split("\n").slice(0, 3), ["-T", "--", "remote-alias"]);
        assertEquals(await exists(join(local, ".wld")), false);
        assertEquals(await exists(join(local, ".git")), false);
        assertEquals(await exists(join(remote, ".cache")), false);
    });
});

Deno.test("remote CLI keeps shell metacharacters in the target path literal", async () => {
    await withRemoteFixture(async ({ run, remote, sshLog }) => {
        const name = "space ' $(touch BAD); folder";
        await Deno.mkdir(join(remote, name));
        const result = await run([`remote-alias:${name}`]);
        // Reaching artifact verification proves the existing directory was found.
        assertStringIncludes(result.stderr, "Missing x86_64-unknown-linux-gnu artifact");
        assertEquals(await exists(join(remote, "BAD")), false);
        const sshArgs = await Deno.readTextFile(sshLog);
        assertEquals(sshArgs.includes(name), false);
    });
});

Deno.test("remote CLI reports an absent remote directory before artifact setup", async () => {
    await withRemoteFixture(async ({ run, remote }) => {
        const result = await run(["remote-alias:missing"]);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "Remote target is not an existing directory");
        assertEquals(await exists(join(remote, ".cache")), false);
    });
});

async function exists(path: string): Promise<boolean> {
    return await Deno.stat(path).then(() => true, () => false);
}
