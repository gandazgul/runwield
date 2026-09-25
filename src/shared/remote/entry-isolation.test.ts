import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const cli = fromFileUrl(new URL("../../cli.ts", import.meta.url));
const projectRoot = dirname(dirname(dirname(cli)));
const pty = String.raw`import fcntl, json, os, pty, select, subprocess, sys, termios, time, tty
cli, cwd, home = sys.argv[1:]
master, slave = pty.openpty()
tty.setraw(slave)  # The supervisor makes the SSH terminal raw before starting the view.
env = dict(os.environ, HOME=home, WLD_TEST_SANDBOX_HOME=home, MNEMOTECA_DB_PATH=os.path.join(home, 'mnemoteca.db'))
def terminal_session():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
child = subprocess.Popen(['deno', 'run', '-A', '--quiet', cli, '--remote-view'], cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave, preexec_fn=terminal_session)
os.close(slave)
config = dict(host='isolated-host', cwd=cwd, status='Connected', trust='SSH verified', readiness='No user turns')
os.write(master, (json.dumps(config) + '\n').encode())
output = b''
deadline = time.monotonic() + 20
try:
    while b'Press q' not in output and time.monotonic() < deadline:
        if select.select([master], [], [], .2)[0]:
            try: output += os.read(master, 65536)
            except OSError: break
    if b'Press q' in output:
        for data in (b'hello\r', b'\x1b[200~pasted text\x1b[201~', b'/settings\r', b'! touch BAD\r', b'@secret.txt\r'):
            os.write(master, data)
            time.sleep(.2)
        time.sleep(.5)
    if b'Press q' in output: os.write(master, b'q')
    time.sleep(.2)
    if child.poll() is None: child.kill()
    child.wait(timeout=5)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
print(json.dumps({'code': child.returncode, 'screen': output.decode(errors='replace')}))`;

async function files(root: string): Promise<string[]> {
    const found: string[] = [];
    async function visit(path: string, relative: string) {
        for await (const entry of Deno.readDir(path)) {
            const name = join(relative, entry.name);
            found.push(name);
            if (entry.isDirectory) await visit(join(path, entry.name), name);
        }
    }
    await visit(root, "");
    return found.sort();
}

for (const populated of [false, true]) {
    Deno.test(`private remote view rejects input in ${populated ? "sentinel" : "empty"} home under a pseudo-terminal`, async () => {
        const root = await Deno.makeTempDir();
        const home = join(root, "home");
        const project = join(root, "project");
        try {
            await Deno.mkdir(home);
            await Deno.mkdir(project);
            await Deno.writeTextFile(join(project, "secret.txt"), "project sentinel");
            await Deno.mkdir(join(project, ".wld"));
            await Deno.writeTextFile(join(project, ".wld/settings.json"), "project settings sentinel");
            if (populated) {
                for (const directory of [".wld", ".wld/skills", ".wld/credentials"]) {
                    await Deno.mkdir(join(home, directory));
                }
                await Deno.writeTextFile(join(home, ".wld/settings.json"), "settings sentinel");
                await Deno.writeTextFile(join(home, ".wld/skills/skill.md"), "skill sentinel");
                await Deno.writeTextFile(join(home, ".wld/credentials/key"), "credential sentinel");
            }
            const before = await files(home);
            const projectBefore = await files(project);
            const result = await new Deno.Command("python3", {
                args: ["-c", pty, cli, project, home],
                cwd: projectRoot,
                stdout: "piped",
                stderr: "piped",
            }).output();
            assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
            const { code, screen } = JSON.parse(new TextDecoder().decode(result.stdout));
            assertEquals([0, -9].includes(code), true, screen);
            assertStringIncludes(screen, "isolated-host");
            // The terminal wraps long absolute directories across rows.
            assertStringIncludes(screen, project.slice(0, 50));
            assertStringIncludes(screen, project.slice(-35));
            assertStringIncludes(screen, "No user turns");
            assertEquals(await files(home), before);
            assertEquals(await files(project), projectBefore);
            assertEquals(await Deno.readTextFile(join(project, "secret.txt")), "project sentinel");
            assertEquals(await Deno.readTextFile(join(project, ".wld/settings.json")), "project settings sentinel");
            assertEquals(await Deno.stat(join(project, "BAD")).then(() => true, () => false), false);
            if (populated) {
                assertEquals(await Deno.readTextFile(join(home, ".wld/settings.json")), "settings sentinel");
                assertEquals(await Deno.readTextFile(join(home, ".wld/skills/skill.md")), "skill sentinel");
                assertEquals(await Deno.readTextFile(join(home, ".wld/credentials/key")), "credential sentinel");
            }
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    });
}
