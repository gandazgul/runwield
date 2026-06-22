import { assert, assertEquals, assertRejects } from "@std/assert";
import {
    buildBubblewrapBashArgs,
    createReadOnlyBashOperations,
    createReadOnlyBashToolDefinition,
} from "./read-only-bash.js";

Deno.test("buildBubblewrapBashArgs creates read-only project sandbox", () => {
    const args = buildBubblewrapBashArgs({
        cwd: "/workspace/project",
        command: "ls -la",
        env: { PATH: "/custom/bin", TERM: "xterm-256color", LANG: "en_US.UTF-8", HOME: "/home/user" },
    });

    assert(args.includes("--unshare-all"));
    assert(args.includes("--die-with-parent"));
    assert(args.includes("--new-session"));
    assertEquals(args.slice(args.indexOf("--cap-drop"), args.indexOf("--cap-drop") + 2), ["--cap-drop", "ALL"]);
    assert(args.includes("--clearenv"));
    assertEquals(args.slice(args.indexOf("--setenv"), args.indexOf("--setenv") + 3), [
        "--setenv",
        "PATH",
        "/custom/bin",
    ]);
    assert(!args.includes("HOME"));
    assertEquals(args.slice(args.indexOf("--tmpfs"), args.indexOf("--tmpfs") + 2), ["--tmpfs", "/tmp"]);
    assertEquals(args.slice(args.indexOf("--dir"), args.indexOf("--dir") + 4), [
        "--dir",
        "/workspace",
        "--ro-bind",
        "/workspace/project",
    ]);
    assertEquals(args.slice(args.indexOf("--ro-bind"), args.indexOf("--ro-bind") + 3), [
        "--ro-bind",
        "/workspace/project",
        "/workspace/project",
    ]);
    assertEquals(args.slice(-4), ["/workspace/project", "sh", "-c", "ls -la"]);
});

Deno.test("read-only bash operations fail closed on unsupported platforms", async () => {
    const ops = createReadOnlyBashOperations({ platform: "darwin" });

    await assertRejects(
        () =>
            ops.exec("echo should-not-run", Deno.cwd(), {
                onData: () => {},
                env: {},
            }),
        Error,
        "requires Bubblewrap on Linux",
    );
});

Deno.test("read-only bash operations fail closed when bubblewrap is missing", async () => {
    const ops = createReadOnlyBashOperations({ platform: "linux", bwrapPath: "harns-missing-bwrap-for-test" });

    await assertRejects(
        () =>
            ops.exec("echo should-not-run", Deno.cwd(), {
                onData: () => {},
                env: {},
            }),
        Error,
        "Read-only bash",
    );
});

Deno.test("createReadOnlyBashToolDefinition keeps bash tool identity and advertises sandbox", () => {
    const tool = createReadOnlyBashToolDefinition(Deno.cwd(), { platform: "darwin" });

    assertEquals(tool.name, "bash");
    assert(tool.description.includes("Bubblewrap read-only sandbox"));
    assert(typeof tool.promptSnippet === "string");
    assert(tool.promptSnippet.includes("read-only sandbox"));
});
