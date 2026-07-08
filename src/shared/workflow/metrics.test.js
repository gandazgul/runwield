import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
    classifyToolSubUsage,
    getWorkflowMetricsFilePath,
    isWorkflowMetricsEnabled,
    recordToolCallFinished,
    recordToolCallStarted,
    recordWorkflowMetric,
    sanitizeMetricDetails,
} from "./metrics.js";

Deno.test("isWorkflowMetricsEnabled honors boolean and object opt-in settings", () => {
    assertEquals(isWorkflowMetricsEnabled(undefined), false);
    assertEquals(isWorkflowMetricsEnabled(false), false);
    assertEquals(isWorkflowMetricsEnabled({ enabled: false }), false);
    assertEquals(isWorkflowMetricsEnabled(true), true);
    assertEquals(isWorkflowMetricsEnabled({ enabled: true }), true);
});

Deno.test("recordWorkflowMetric skips writes when disabled", async () => {
    const tempHome = await Deno.makeTempDir();
    try {
        await recordWorkflowMetric(
            { category: "routing", event: "triage_reported", details: { routingIntent: "INQUIRY" } },
            { cwd: "/tmp/project-a", homeDir: tempHome, settings: false },
        );
        await assertRejects(() => Deno.stat(getWorkflowMetricsFilePath("/tmp/project-a", tempHome)));
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("recordWorkflowMetric writes sanitized JSONL when enabled", async () => {
    const tempHome = await Deno.makeTempDir();
    try {
        const record = await recordWorkflowMetric(
            {
                category: "validation",
                event: "ci_attempt",
                planName: "safe-plan",
                agentName: "engineer",
                details: {
                    exitCode: 1,
                    output: "do not keep ci output",
                    worktreePath: "/Users/someone/project/worktree",
                    safeString: "ok",
                },
            },
            {
                cwd: "/tmp/project-b",
                homeDir: tempHome,
                settings: true,
                now: () => new Date("2026-01-01T00:00:00.000Z"),
            },
        );
        assertExists(record);
        const filePath = getWorkflowMetricsFilePath("/tmp/project-b", tempHome);
        const lines = (await Deno.readTextFile(filePath)).trim().split("\n");
        assertEquals(lines.length, 1);
        const parsed = JSON.parse(lines[0]);
        assertEquals(parsed.v, 1);
        assertEquals(parsed.ts, "2026-01-01T00:00:00.000Z");
        assertEquals(parsed.category, "validation");
        assertEquals(parsed.event, "ci_attempt");
        assertEquals(parsed.planName, "safe-plan");
        assert(typeof parsed.cwdHash === "string" && parsed.cwdHash.length === 64);
        assertEquals(parsed.details.output, "[redacted]");
        assertEquals(parsed.details.worktreePath, "[path-redacted]");
        assertEquals(parsed.details.safeString, "ok");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("recordWorkflowMetric swallows write failures", async () => {
    const record = await recordWorkflowMetric(
        { category: "routing", event: "dispatch_selected", details: { routingIntent: "FEATURE" } },
        {
            cwd: "/tmp/project-c",
            homeDir: "/tmp/home-c",
            settings: true,
            mkdir: async () => {},
            writeTextFile: () => Promise.reject(new Error("disk full")),
        },
    );
    assertExists(record);
});

Deno.test("sanitizeMetricDetails redacts sensitive keys, paths, and long strings", () => {
    const long = "x".repeat(400);
    const sanitized = /** @type {any} */ (sanitizeMetricDetails({
        prompt: "secret prompt",
        token: "abc",
        cwd: "/Users/example/project",
        nested: { diffText: "patch", value: long },
    }));
    assertEquals(sanitized.prompt, "[redacted]");
    assertEquals(sanitized.token, "[redacted]");
    assertEquals(sanitized.cwd, "[path-redacted]");
    assertEquals(sanitized.nested.diffText, "[redacted]");
    assert(sanitized.nested.value.length < long.length);
});

Deno.test("sanitizeMetricDetails redacts generic relative paths but preserves affectedPaths metadata", () => {
    const sanitized = /** @type {any} */ (sanitizeMetricDetails({
        path: "src/private/file.js",
        file: "plans/secret.md",
        affectedPaths: ["src/visible.js", "docs/visible.md", "/Users/example/project/secret.js"],
    }));
    assertEquals(sanitized.path, "[path-redacted]");
    assertEquals(sanitized.file, "[path-redacted]");
    assertEquals(sanitized.affectedPaths, ["src/visible.js", "docs/visible.md", "[path-redacted]"]);
});

Deno.test("sanitizeMetricDetails omits non-plain objects instead of stringifying them", () => {
    const sanitized = /** @type {any} */ (sanitizeMetricDetails({
        ok: true,
        error: new Error("/Users/example/project/secret.js failed with private output"),
        url: new URL("file:///Users/example/project/secret.js"),
        items: ["safe", new Error("unsafe output")],
    }));
    assertEquals(sanitized.ok, true);
    assertEquals("error" in sanitized, false);
    assertEquals("url" in sanitized, false);
    assertEquals(sanitized.items, ["safe"]);
});

Deno.test("recordWorkflowMetric accepts each workflow metric category", async () => {
    const tempHome = await Deno.makeTempDir();
    try {
        const categories = [
            "routing",
            "planning",
            "execution",
            "validation",
            "recovery",
            "model_selection",
            "tool_usage",
        ];
        for (const category of categories) {
            await recordWorkflowMetric(
                { category: /** @type {any} */ (category), event: `${category}_event`, details: { ok: true } },
                { cwd: "/tmp/project-d", homeDir: tempHome, settings: { enabled: true } },
            );
        }
        const lines = (await Deno.readTextFile(getWorkflowMetricsFilePath("/tmp/project-d", tempHome))).trim().split(
            "\n",
        );
        assertEquals(lines.length, categories.length);
        assertEquals(lines.map((line) => JSON.parse(line).category), categories);
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("classifyToolSubUsage returns coarse categories only", () => {
    assertEquals(classifyToolSubUsage("bash", { command: "deno task ci --filter secret" }), "validation_command");
    assertEquals(classifyToolSubUsage("bash", { command: "git status --short" }), "git");
    assertEquals(classifyToolSubUsage("code_search", { query: "private query" }), "search");
    assertEquals(classifyToolSubUsage("memory_store", { content: "private memory text" }), "write");
    assertEquals(classifyToolSubUsage("write", { content: "file contents" }), "write");
});

Deno.test("tool usage metrics omit raw commands, queries, file contents, messages, and results", () => {
    /** @type {any[]} */
    const metrics = [];
    const recordMetric = (/** @type {any} */ metric) => {
        metrics.push(metric);
        return Promise.resolve(null);
    };

    recordToolCallStarted(
        "tool-1",
        "bash",
        { command: "grep -R private-query src && cat secret.txt" },
        "Engineer",
        { recordWorkflowMetric: recordMetric, now: () => 100 },
    );
    recordToolCallFinished("tool-1", "bash", true, "Engineer", { recordWorkflowMetric: recordMetric, now: () => 125 });

    assertEquals(metrics.length, 2);
    assertEquals(metrics[0].category, "tool_usage");
    assertEquals(metrics[0].details, { toolName: "bash", subUsage: "filesystem" });
    assertEquals(metrics[1].details, {
        toolName: "bash",
        subUsage: "filesystem",
        isError: true,
        durationMs: 25,
    });
    const serialized = JSON.stringify(metrics);
    assertEquals(serialized.includes("private-query"), false);
    assertEquals(serialized.includes("secret.txt"), false);
    assertEquals(serialized.includes("grep -R"), false);
});
