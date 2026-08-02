import { assertEquals } from "@std/assert";
import snipExtension, { __testing } from "./index.js";

const SNIP_NO_FILTER_STDERR_PATTERN = `^snip: no filter for ".+", passing through -- you can run ".+" directly$`;

/** @param {string} command */
function expectedRewrite(command) {
    return `( runwield_snip_stderr="$(mktemp -t runwield-snip-stderr.XXXXXX)" || exit 1; ` +
        `trap 'rm -f "$runwield_snip_stderr"' EXIT; ${command} 2>"$runwield_snip_stderr"; ` +
        `runwield_snip_status=$?; grep -vE '${SNIP_NO_FILTER_STDERR_PATTERN}' "$runwield_snip_stderr" >&2; ` +
        `exit "$runwield_snip_status" )`;
}

function setup() {
    /** @type {Map<string, (event: any, ctx: any) => any>} */
    const handlers = new Map();

    const pi = /** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, handler);
        },
    });

    snipExtension(pi);

    /** @param {string} event */
    const getHandler = (event) => handlers.get(event);
    return { getHandler };
}

Deno.test("snip extension rewrites bash tool calls in place", async () => {
    const setupResult = setup();

    const handler = setupResult.getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const event = { toolName: "bash", input: { command: "deno test" } };
    await handler(event, {});

    assertEquals(event.input.command, expectedRewrite("snip run -- deno test"));
});

Deno.test("snip extension ignores non-bash, empty, and already snip commands", async () => {
    const noOp = setup();
    const noOpHandler = noOp.getHandler("tool_call");
    if (!noOpHandler) throw new Error("tool_call handler not registered");

    const readEvent = { toolName: "read", input: { command: "deno test" } };
    await noOpHandler(readEvent, {});

    const emptyEvent = { toolName: "bash", input: { command: "  " } };
    await noOpHandler(emptyEvent, {});
    assertEquals(emptyEvent.input.command, "  ");

    const snipEvent = { toolName: "bash", input: { command: "snip run -- deno test" } };
    await noOpHandler(snipEvent, {});
    assertEquals(snipEvent.input.command, "snip run -- deno test");
});

Deno.test("snip extension handles shell safety and env prefixes", async () => {
    const { getHandler } = setup();
    const handler = getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const cdEvent = { toolName: "bash", input: { command: "cd repo && deno test" } };
    await handler(cdEvent, {});
    assertEquals(cdEvent.input.command, "cd repo && deno test");

    const gitCloneEvent = {
        toolName: "bash",
        input: { command: "git clone https://example.test/repo.git third_party/repo" },
    };
    await handler(gitCloneEvent, {});
    assertEquals(gitCloneEvent.input.command, "git clone https://example.test/repo.git third_party/repo");

    const gitWorktreeEvent = { toolName: "bash", input: { command: "git worktree add -b demo ../demo HEAD" } };
    await handler(gitWorktreeEvent, {});
    assertEquals(gitWorktreeEvent.input.command, "git worktree add -b demo ../demo HEAD");

    const gitDiffEvent = { toolName: "bash", input: { command: "/usr/bin/git -C repo diff --cached" } };
    await handler(gitDiffEvent, {});
    assertEquals(gitDiffEvent.input.command, "/usr/bin/git -C repo diff --cached");

    const envEvent = { toolName: "bash", input: { command: "FOO=1 deno test" } };
    await handler(envEvent, {});
    assertEquals(envEvent.input.command, expectedRewrite("FOO=1 snip run -- deno test"));

    const chainEvent = { toolName: "bash", input: { command: "deno test && echo done" } };
    await handler(chainEvent, {});
    assertEquals(chainEvent.input.command, `${expectedRewrite("snip run -- deno test")}&& echo done`);

    const extraEnvEvent = {
        toolName: "bash",
        input: { command: "BAR=/tmp/custom deno lint" },
    };
    await handler(extraEnvEvent, {});
    assertEquals(extraEnvEvent.input.command, expectedRewrite("BAR=/tmp/custom snip run -- deno lint"));

    const snippetEvent = { toolName: "bash", input: { command: "snippets list" } };
    await handler(snippetEvent, {});
    assertEquals(snippetEvent.input.command, expectedRewrite("snip run -- snippets list"));
});

Deno.test("snip extension does not rewrite command substitutions", async () => {
    const { getHandler } = setup();
    const handler = getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const tempDirEvent = { toolName: "bash", input: { command: 'tmp=$(mktemp -d); cd "$tmp"; pwd' } };
    await handler(tempDirEvent, {});
    assertEquals(tempDirEvent.input.command, 'tmp=$(mktemp -d); cd "$tmp"; pwd');

    const inlineEvent = { toolName: "bash", input: { command: "echo $(date)" } };
    await handler(inlineEvent, {});
    assertEquals(inlineEvent.input.command, "echo $(date)");

    const backtickEvent = { toolName: "bash", input: { command: "echo `date`" } };
    await handler(backtickEvent, {});
    assertEquals(backtickEvent.input.command, "echo `date`");
});

Deno.test("snip extension filters the no-filter notice without changing output or exit status", async () => {
    const successCommand = __testing.rewriteCommand("printf success && printf chained");
    if (!successCommand) throw new Error("Expected success command to be rewritten.");

    const fakeSnip =
        `snip() { shift 2; printf 'snip: no filter for "printf", passing through -- you can run "printf" directly\\n' >&2; "$@"; }; `;
    const success = await new Deno.Command("/bin/bash", {
        args: ["-c", `${fakeSnip}${successCommand}`],
        stdout: "piped",
        stderr: "piped",
    }).output();
    assertEquals(success.code, 0);
    assertEquals(new TextDecoder().decode(success.stdout), "successchained");
    assertEquals(new TextDecoder().decode(success.stderr), "");

    const stderrCommand = __testing.rewriteCommand("printf visible-error >&2");
    if (!stderrCommand) throw new Error("Expected stderr command to be rewritten.");
    const stderrResult = await new Deno.Command("/bin/bash", {
        args: ["-c", `${fakeSnip}${stderrCommand}`],
        stdout: "piped",
        stderr: "piped",
    }).output();
    assertEquals(stderrResult.code, 0);
    assertEquals(new TextDecoder().decode(stderrResult.stdout), "");
    assertEquals(new TextDecoder().decode(stderrResult.stderr), "visible-error");

    const failureCommand = __testing.rewriteCommand("false && printf should-not-run");
    if (!failureCommand) throw new Error("Expected failure command to be rewritten.");
    const failure = await new Deno.Command("/bin/bash", {
        args: ["-c", `${fakeSnip}${failureCommand}`],
        stdout: "piped",
        stderr: "piped",
    }).output();
    assertEquals(failure.code, 1);
    assertEquals(new TextDecoder().decode(failure.stdout), "");
    assertEquals(new TextDecoder().decode(failure.stderr), "");
});
