import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { withRuntimeCommandFixture } from "../src/cmd/testing/runtime-command-fixture.ts";
import { defineGitFixture, git } from "../src/shared/git-test-fixture.ts";
import {
    main,
    mergeGoldenRowsWithResultRows,
    normalizeGoldenRow,
    runRouterGoldenSet,
} from "./run-router-golden-set.js";
import { parseCsv, ROUTER_JUDGEMENT_COLUMNS, toCsv } from "./router-eval-utils.js";

const fixture = defineGitFixture(async (cwd) => {
    await Deno.writeTextFile(join(cwd, "marker.txt"), "before");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "before"]);
    await Deno.writeTextFile(join(cwd, "marker.txt"), "after");
    await git(cwd, ["commit", "-am", "after"]);
});

function triageMessages() {
    return [{
        role: "toolResult",
        toolName: "triage_report",
        details: { routingIntent: "INQUIRY", complexity: "LOW", summary: "answer" },
    }];
}

/** @param {string} contextCommit */
function row(contextCommit) {
    return { requestText: "what is in marker.txt?", humanJudgement: "INQUIRY", contextCommit };
}

Deno.test("pinned rows discover each commit without changing the dirty source checkout", async () => {
    const cwd = await fixture.checkout();
    try {
        const before = await git(cwd, ["rev-parse", "HEAD~1"]);
        const after = await git(cwd, ["rev-parse", "HEAD"]);
        await Deno.writeTextFile(join(cwd, "marker.txt"), "local edits");
        await Deno.writeTextFile(join(cwd, "untracked.txt"), "keep");
        const status = await git(cwd, ["status", "--porcelain"]);
        const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
        const contents = [];
        const heads = [];
        const paths = [];
        const rows = await runRouterGoldenSet([row(before), row(after), row(before), row("")], {
            cwd,
            runAgentSession: async (options) => {
                if (!options.cwd) throw new Error("missing discovery cwd");
                paths.push(options.cwd);
                if (paths.length === 1) {
                    await Deno.writeTextFile(join(options.cwd, "generated-index"), "retained");
                } else if (paths.length < 4) {
                    assertEquals(await Deno.readTextFile(join(options.cwd, "generated-index")), "retained");
                }
                contents.push(await Deno.readTextFile(join(options.cwd, "marker.txt")));
                heads.push(await git(options.cwd, ["rev-parse", "HEAD"]));
                return triageMessages();
            },
        });
        assertEquals(rows.map((r) => r.routerDecision), ["INQUIRY", "INQUIRY", "INQUIRY", "INQUIRY"]);
        assertEquals(contents, ["before", "after", "before", "local edits"]);
        assertEquals(heads, [before, after, before, after]);
        assertEquals(paths[0] === cwd, false);
        assertEquals(paths.slice(0, 3), [paths[0], paths[0], paths[0]]);
        assertEquals(paths[3], cwd);
        assertEquals(await git(cwd, ["symbolic-ref", "HEAD"]), "refs/heads/main");
        assertEquals(await git(cwd, ["status", "--porcelain"]), status);
        assertEquals(await Deno.readTextFile(join(cwd, "untracked.txt")), "keep");
        assertEquals(await git(cwd, ["worktree", "list", "--porcelain"]), worktrees);
        for (const path of paths.slice(0, 3)) {
            assertEquals(await Deno.stat(path).then(() => true).catch(() => false), false);
        }
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("missing commits fail the row without falling back to current context", async () => {
    const cwd = await fixture.checkout();
    try {
        const requests = [];
        const rows = await runRouterGoldenSet([row("f".repeat(40)), row("")], {
            cwd,
            runAgentSession: (options) => {
                requests.push(options.cwd);
                return Promise.resolve(triageMessages());
            },
        });
        assertEquals(rows[0].routerDecision, "");
        assertStringIncludes(String(rows[0].routerSummary), "ERROR: Context Git failed:");
        assertEquals(rows[1].routerDecision, "INQUIRY");
        assertEquals(requests, [cwd]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("missing commits between pinned rows do not run Router against the previous commit", async () => {
    const cwd = await fixture.checkout();
    try {
        const before = await git(cwd, ["rev-parse", "HEAD~1"]);
        const after = await git(cwd, ["rev-parse", "HEAD"]);
        const contents = [];
        const rows = await runRouterGoldenSet([row(before), row("f".repeat(40)), row(after)], {
            cwd,
            runAgentSession: async (options) => {
                if (!options.cwd) throw new Error("missing discovery cwd");
                contents.push(await Deno.readTextFile(join(options.cwd, "marker.txt")));
                return triageMessages();
            },
        });
        assertEquals(contents, ["before", "after"]);
        assertEquals(rows.map((result) => result.routerDecision), ["INQUIRY", "", "INQUIRY"]);
        assertStringIncludes(String(rows[1].routerSummary), "ERROR: Context Git failed:");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("checkpoint failure removes the shared benchmark worktree", async () => {
    const cwd = await fixture.checkout();
    try {
        const commit = await git(cwd, ["rev-parse", "HEAD"]);
        const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
        let failure = "";
        try {
            await runRouterGoldenSet([row(commit)], {
                cwd,
                runAgentSession: () => Promise.resolve(triageMessages()),
                onRowComplete: () => {
                    throw new Error("checkpoint failed");
                },
            });
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
        }
        assertEquals(failure, "checkpoint failed");
        assertEquals(await git(cwd, ["worktree", "list", "--porcelain"]), worktrees);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("context pins reject branch names, abbreviated hashes, and option-like values", async () => {
    const rows = await runRouterGoldenSet([row("main"), row("a".repeat(7)), row("--all")], {
        runAgentSession: () => Promise.reject(new Error("must not invoke Router")),
    });
    for (const result of rows) {
        assertEquals(result.routerDecision, "");
        assertStringIncludes(String(result.routerSummary), "ERROR: Invalid contextCommit:");
    }
});

Deno.test("an agent failure allows worktree reuse before run-end cleanup", async () => {
    const cwd = await fixture.checkout();
    try {
        const commit = await git(cwd, ["rev-parse", "HEAD"]);
        const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
        let discoveryCwd = "";
        const before = await git(cwd, ["rev-parse", "HEAD~1"]);
        const rows = await runRouterGoldenSet([row(commit), row(before)], {
            cwd,
            runAgentSession: async (options) => {
                if (!options.cwd) throw new Error("missing discovery cwd");
                if (!discoveryCwd) {
                    discoveryCwd = options.cwd;
                    await Deno.writeTextFile(join(discoveryCwd, "generated-index"), "temporary");
                    throw new Error("model failed");
                }
                assertEquals(options.cwd, discoveryCwd);
                assertEquals(await Deno.readTextFile(join(discoveryCwd, "marker.txt")), "before");
                assertEquals(await Deno.readTextFile(join(discoveryCwd, "generated-index")), "temporary");
                return triageMessages();
            },
        });
        assertEquals(rows[0].routerSummary, "ERROR: model failed");
        assertEquals(rows[1].routerDecision, "INQUIRY");
        assertEquals(await git(cwd, ["worktree", "list", "--porcelain"]), worktrees);
        assertEquals(await Deno.stat(discoveryCwd).then(() => true).catch(() => false), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("pinned worktrees are removed after a row timeout", async () => {
    const cwd = await fixture.checkout();
    try {
        const commit = await git(cwd, ["rev-parse", "HEAD"]);
        const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
        const rows = await runRouterGoldenSet([row(commit)], {
            cwd,
            rowTimeoutMs: 10,
            runAgentSession: () => new Promise(() => {}),
        });
        assertEquals(rows[0].routerSummary, "ERROR: Router golden row timed out after 10ms.");
        assertEquals(await git(cwd, ["worktree", "list", "--porcelain"]), worktrees);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("context pins survive normalization and result CSV checkpoints", () => {
    const commit = "a".repeat(40);
    const normalized = normalizeGoldenRow(row(` ${commit.toUpperCase()} `), 0);
    const saved = parseCsv(toCsv(ROUTER_JUDGEMENT_COLUMNS, [normalized]));
    assertEquals(saved[0].contextCommit, commit);
});

Deno.test("resume discards prior decisions when the golden context changes", () => {
    const oldCommit = "a".repeat(40);
    const newCommit = "b".repeat(40);
    for (const contextCommit of [newCommit, ""]) {
        const rows = mergeGoldenRowsWithResultRows([
            { ...row(contextCommit), decisionId: "d1", routerDecision: "INQUIRY" },
        ], [{
            ...row(oldCommit),
            decisionId: "d1",
            routerDecision: "INQUIRY",
            routerSummary: "old context",
        }]);
        assertEquals(rows[0].contextCommit, contextCommit);
        assertEquals(rows[0].routerDecision, "");
        assertEquals(rows[0].routerSummary, "");
    }
});

Deno.test("benchmark CLI binds real Router read tools to each pinned commit", async () => {
    const cwd = await fixture.checkout();
    try {
        const before = await git(cwd, ["rev-parse", "HEAD~1"]);
        const after = await git(cwd, ["rev-parse", "HEAD"]);
        await withRuntimeCommandFixture(
            "router-context-runtime-",
            async ({ projectRoot, setModelResponseFactories }) => {
                const csv = join(projectRoot, "gold.csv");
                const out = join(projectRoot, "results.csv");
                await Deno.writeTextFile(
                    csv,
                    toCsv(ROUTER_JUDGEMENT_COLUMNS, [
                        { ...row(before), decisionId: "before" },
                        { ...row(after), decisionId: "after" },
                    ]),
                );
                const reads = [];
                /** @type {import('@earendil-works/pi-ai').FauxResponseFactory} */
                const response = (context) => {
                    const last = context.messages.at(-1);
                    if (last?.role === "toolResult" && last.toolName === "read") {
                        reads.push(
                            last.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
                        );
                        return fauxAssistantMessage(fauxToolCall("triage_report", {
                            routingIntent: "INQUIRY",
                            complexity: "LOW",
                            summary: "Read committed context",
                        }));
                    }
                    if (last?.role === "toolResult" && last.toolName === "triage_report") {
                        return fauxAssistantMessage(fauxText("Done."));
                    }
                    return fauxAssistantMessage(fauxToolCall("read", { path: "marker.txt" }));
                };
                setModelResponseFactories(Array.from({ length: 6 }, () => response));
                await main([
                    "--csv",
                    csv,
                    "--out",
                    out,
                    "--cwd",
                    cwd,
                    "--model",
                    "runtime-command-fixture/fixture-model",
                    "--rerun",
                ]);
                const results = parseCsv(await Deno.readTextFile(out));
                assertEquals(
                    results.map((result) => result.routerDecision),
                    ["INQUIRY", "INQUIRY"],
                    results.map((result) => result.routerSummary).join("\n"),
                );
                assertEquals(results.map((result) => result.contextCommit), [before, after]);
                assertEquals(reads, ["before", "after"]);
            },
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("resume preserves prior decisions for the same commit", () => {
    const contextCommit = "a".repeat(40);
    const rows = mergeGoldenRowsWithResultRows([
        { ...row(contextCommit), decisionId: "d1" },
    ], [{ ...row(contextCommit), decisionId: "d1", routerDecision: "INQUIRY" }]);
    assertEquals(rows[0].routerDecision, "INQUIRY");
});
