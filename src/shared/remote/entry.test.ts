import { assertEquals, assertStringIncludes } from "@std/assert";

const decoder = new TextDecoder();

async function privateEntry(args: string[], input?: string) {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--quiet", "src/cli.ts", ...args],
        stdin: input === undefined ? "null" : "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    if (input !== undefined) {
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(input));
        await writer.close();
    }
    const result = await child.output();
    return {
        code: result.code,
        stdout: decoder.decode(result.stdout),
        stderr: decoder.decode(result.stderr),
    };
}

Deno.test("remote preflight runs before ordinary CLI startup", async () => {
    const result = await privateEntry(["--remote-preflight"]);
    if (result.code === 0) {
        const identity = JSON.parse(result.stdout);
        assertEquals(typeof identity.buildId, "string");
        assertEquals(identity.buildId.length, 64);
        assertEquals(Number.isInteger(identity.protocol), true);
        assertEquals(typeof identity.version, "string");
    } else {
        // Source checkouts have no generated build identity and must not
        // present themselves as a deployable remote artifact.
        assertStringIncludes(result.stderr, "build-identity.js");
        assertEquals(result.stdout, "");
    }
    assertEquals(result.stderr.includes("Unknown option"), false);
});

Deno.test("remote view rejects malformed configuration before terminal or registry startup", async () => {
    const result = await privateEntry(["--remote-view"], "{}\n");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "Invalid remote view host");
    assertEquals(result.stdout, "");
    assertEquals(result.stderr.includes("Unknown option"), false);
});

Deno.test("remote view renders supplied facts and exits on q", async () => {
    const config = {
        host: "remote-server",
        cwd: "/srv/project",
        status: "Connected",
        trust: "SSH verified",
        readiness: "Waiting",
    };
    const result = await privateEntry(["--remote-view"], `${JSON.stringify(config)}\nq`);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "remote-server");
    assertStringIncludes(result.stdout, "/srv/project");
    assertStringIncludes(result.stdout, "Waiting");
    assertEquals(result.stderr, "");
});

Deno.test("remote view rejects an unfinished input header", async () => {
    const result = await privateEntry(["--remote-view"], '{"host":"server"}');
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "configuration is missing or incomplete");
});
