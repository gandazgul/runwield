import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runBoundedTest, runWithSnip } from "./run-with-snip.ts";

Deno.test("runWithSnip preserves compact success output", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-snip-command-success-" });
    try {
        const snipPath = join(root, "snip");
        await Deno.writeTextFile(
            snipPath,
            "#!/bin/sh\nprintf 'all tests passed\\n'\nprintf 'snip: tracking error: ignored\\n' >&2\n",
        );
        await Deno.chmod(snipPath, 0o755);

        const result = await runWithSnip("deno", ["test"], {
            env: { PATH: `${root}:${Deno.env.get("PATH") || ""}` },
            failureLabel: "tests",
        });

        assertEquals(result, { code: 0, stdout: "all tests passed\n", stderr: "" });
    } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
});

Deno.test("runWithSnip stores only Deno failure diagnostics", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-snip-command-failure-" });
    let failureLogPath = "";
    try {
        const snipPath = join(root, "snip");
        await Deno.writeTextFile(
            snipPath,
            `#!/bin/sh
printf '%s\n' 'Check src/pass.ts' 'running 2 tests from ./sample.test.ts' 'passing ... ok (1ms)' 'failure ... FAILED (2ms)' 'AssertionError: expected true' 'FAILED | 1 passed | 1 failed (3ms)'
printf 'snip: tracking error: test database is read-only\n' >&2
exit 1
`,
        );
        await Deno.chmod(snipPath, 0o755);

        const result = await runWithSnip("deno", ["test", "sample.test.ts"], {
            env: { PATH: `${root}:${Deno.env.get("PATH") || ""}` },
            failureLabel: "tests",
        });
        failureLogPath = result.failureLogPath || "";

        assertEquals(result.code, 1);
        assertEquals(result.stdout, "");
        assertStringIncludes(result.stderr, `tests failed, read the failure log here: ${failureLogPath}`);
        const failureLog = await Deno.readTextFile(failureLogPath);
        assertStringIncludes(failureLog, "failure ... FAILED");
        assertStringIncludes(failureLog, "AssertionError: expected true");
        assertEquals(failureLog.includes("Check src/pass.ts"), false);
        assertEquals(failureLog.includes("passing ... ok"), false);
        assertEquals(failureLog.includes("passed"), false);
        assertEquals(failureLog.includes("tracking error"), false);
    } finally {
        if (failureLogPath) await Deno.remove(failureLogPath).catch(() => {});
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
});

Deno.test("a timed-out test stops its process and reports the timeout", async () => {
    const pidPath = await Deno.makeTempFile({ prefix: "runwield-test-timeout-" });
    let failureLogPath = "";
    try {
        const result = await runBoundedTest([
            "eval",
            `Deno.writeTextFileSync(${JSON.stringify(pidPath)}, String(Deno.pid)); setInterval(() => {}, 1000);`,
        ], { failureLabel: "tests", timeoutMs: 500 });
        failureLogPath = result.failureLogPath || "";
        assertEquals(result.code, 124);
        assertStringIncludes(result.stderr, "tests timed out");
        assertStringIncludes(await Deno.readTextFile(failureLogPath), "exceeded 0.5s");
        const pid = Number(await Deno.readTextFile(pidPath));
        let stopped = false;
        try {
            Deno.kill(pid, "SIGTERM");
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            stopped = true;
        }
        assertEquals(stopped, true);
    } finally {
        if (failureLogPath) await Deno.remove(failureLogPath).catch(() => {});
        await Deno.remove(pidPath).catch(() => {});
    }
});

Deno.test("quiet Snip commands preserve failures from real subprocesses", async () => {
    const success = await runWithSnip("deno", ["eval", 'console.log("verbose success")'], {
        failureLabel: "quiet success",
        quietOnSuccess: true,
    });
    assertEquals(success, { code: 0, stdout: "", stderr: "" });
    const failure = await runWithSnip("deno", ["eval", 'console.error("real failure evidence"); Deno.exit(7)'], {
        failureLabel: "quiet failure",
        quietOnSuccess: true,
    });
    try {
        assertEquals(failure.code, 7);
        assertStringIncludes(await Deno.readTextFile(failure.failureLogPath!), "real failure evidence");
        assertStringIncludes(failure.stderr, failure.failureLogPath!);
    } finally {
        if (failure.failureLogPath) await Deno.remove(failure.failureLogPath);
    }
});
