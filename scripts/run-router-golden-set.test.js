import { assertEquals } from "@std/assert";
import {
    buildRouterGoldenReport,
    createBenchmarkBashNudgeTool,
    normalizeGoldenRow,
    runRouterForGoldenRequest,
    runRouterGoldenSet,
    runRouterGoldenSetWithSelection,
} from "./run-router-golden-set.js";

Deno.test("normalizeGoldenRow fills stable defaults and router metrics", () => {
    assertEquals(
        normalizeGoldenRow({
            requestText: "fix it",
            routerDecision: "QUICK_FIX",
            humanJudgement: "FEATURE",
        }, 0),
        {
            decisionId: "golden-0001",
            timestamp: "",
            attribution: "golden_fixture",
            requestText: "fix it",
            routerDecision: "QUICK_FIX",
            humanJudgement: "FEATURE",
            humanNotes: "",
            routerSummary: "",
            routerAffectedPaths: "",
            routerAgreesWithHuman: "FALSE",
            routerCorrection: "QUICK_FIX->FEATURE",
            routerDistanceFromHuman: 1,
            routerDisagreementKind: "scope_underestimated",
        },
    );
});

Deno.test("runRouterForGoldenRequest returns latest triage_report outcome", async () => {
    /** @type {string[] | undefined} */
    let capturedToolNames;
    /** @type {string[] | undefined} */
    let capturedCustomToolNames;
    const triage = await runRouterForGoldenRequest("where is router?", {
        runAgentSession: (opts) => {
            capturedToolNames = opts.toolNames;
            capturedCustomToolNames = opts.customTools?.map((tool) => tool.name);
            return Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "triage_report",
                    details: {
                        routingIntent: "INQUIRY",
                        complexity: "LOW",
                        summary: "answer",
                        affectedPaths: [],
                    },
                }]),
            );
        },
    });

    assertEquals(triage.routingIntent, "INQUIRY");
    assertEquals(capturedToolNames?.includes("triage_report"), true);
    assertEquals(capturedToolNames?.includes("bash"), false);
    assertEquals(capturedCustomToolNames?.includes("bash"), true);
});

Deno.test("benchmark bash tool nudges without executing commands", async () => {
    const tool = createBenchmarkBashNudgeTool();
    const result = await tool.execute(
        "call-1",
        { command: "git status" },
        new AbortController().signal,
        () => {},
        /** @type {any} */ ({}),
    );

    const content = result.content[0];
    assertEquals(result.details.blocked, true);
    assertEquals(result.details.command, "git status");
    assertEquals(content.type, "text");
    if (content.type !== "text") throw new Error("expected text content");
    assertEquals(content.text.includes("bash is disabled"), true);
    assertEquals(content.text.includes("call triage_report"), true);
});

Deno.test("runRouterForGoldenRequest accepts injected triage outcome", async () => {
    const triage = await runRouterForGoldenRequest("where is router?", {
        runAgentSession: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "triage_report",
                    details: {
                        routingIntent: "INQUIRY",
                        complexity: "LOW",
                        summary: "answer",
                        affectedPaths: [],
                    },
                }]),
            ),
    });

    assertEquals(triage.routingIntent, "INQUIRY");
});

Deno.test("runRouterGoldenSet updates labelled rows and honors limit", async () => {
    const rows = await runRouterGoldenSet([
        { decisionId: "d1", requestText: "hi", humanJudgement: "INQUIRY" },
        { decisionId: "d2", requestText: "fix it", humanJudgement: "QUICK_FIX" },
    ], {
        limit: 1,
        runAgentSession: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "triage_report",
                    details: {
                        routingIntent: "INQUIRY",
                        complexity: "LOW",
                        summary: "greeting",
                        affectedPaths: ["README.md"],
                    },
                }]),
            ),
    });

    assertEquals(rows[0].routerDecision, "INQUIRY");
    assertEquals(rows[0].routerSummary, "greeting");
    assertEquals(rows[0].routerAffectedPaths, "README.md");
    assertEquals(rows[0].routerAgreesWithHuman, "TRUE");
    assertEquals(rows[1].routerDecision, "");
});

Deno.test("runRouterGoldenSetWithSelection returns selected indexes for limited reports", async () => {
    const result = await runRouterGoldenSetWithSelection([
        { decisionId: "d1", requestText: "hi", humanJudgement: "INQUIRY" },
        { decisionId: "d2", requestText: "fix it", humanJudgement: "QUICK_FIX", routerDecision: "QUICK_FIX" },
    ], {
        limit: 1,
        runAgentSession: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "triage_report",
                    details: {
                        routingIntent: "INQUIRY",
                        complexity: "LOW",
                        summary: "greeting",
                        affectedPaths: [],
                    },
                }]),
            ),
    });

    assertEquals(result.selectedIndexes, [0]);
    assertEquals(buildRouterGoldenReport(result.selectedIndexes.map((index) => result.rows[index])), {
        labelledRows: 1,
        unlabelledRows: 0,
        router: {
            total: 1,
            agreementCount: 1,
            agreementRate: 1,
            meanDistance: 0,
            invalidRows: 0,
            unscoredRows: 0,
            corrections: {},
        },
    });
});

Deno.test("runRouterGoldenSet clears stale decisions before rerunning rows", async () => {
    /** @type {Array<Array<Record<string, unknown>>>} */
    const checkpoints = [];
    const rows = await runRouterGoldenSet([
        {
            decisionId: "d1",
            requestText: "hi",
            humanJudgement: "INQUIRY",
            routerDecision: "QUICK_FIX",
            routerSummary: "old summary",
            routerAffectedPaths: "old.js",
        },
    ], {
        runAgentSession: () => new Promise(() => {}),
        rowTimeoutMs: 1,
        onRowComplete: (checkpointRows) => {
            checkpoints.push(checkpointRows.map((row) => ({ ...row })));
        },
    });

    assertEquals(rows[0].routerDecision, "");
    assertEquals(rows[0].routerSummary, "ERROR: Router golden row timed out after 1ms.");
    assertEquals(rows[0].routerAffectedPaths, "");
    assertEquals(checkpoints[0][0].routerDecision, "");
});

Deno.test("runRouterGoldenSet records row errors and continues", async () => {
    const rows = await runRouterGoldenSet([
        { decisionId: "d1", requestText: "hi", humanJudgement: "INQUIRY" },
    ], {
        runAgentSession: () => {
            throw new Error("model failed");
        },
    });

    assertEquals(rows[0].routerDecision, "");
    assertEquals(rows[0].routerSummary, "ERROR: model failed");
    assertEquals(rows[0].routerAgreesWithHuman, "");
});

Deno.test("runRouterGoldenSet times out slow rows", async () => {
    const rows = await runRouterGoldenSet([
        { decisionId: "d1", requestText: "hi", humanJudgement: "INQUIRY" },
    ], {
        rowTimeoutMs: 1,
        runAgentSession: () => new Promise(() => {}),
    });

    assertEquals(rows[0].routerDecision, "");
    assertEquals(rows[0].routerSummary, "ERROR: Router golden row timed out after 1ms.");
});

Deno.test("buildRouterGoldenReport scores router decisions", () => {
    assertEquals(
        buildRouterGoldenReport([
            { humanJudgement: "INQUIRY", routerDecision: "INQUIRY" },
            { humanJudgement: "FEATURE", routerDecision: "QUICK_FIX" },
            { humanJudgement: "", routerDecision: "PROJECT" },
        ]),
        {
            labelledRows: 2,
            unlabelledRows: 1,
            router: {
                total: 2,
                agreementCount: 1,
                agreementRate: 0.5,
                meanDistance: 0.5,
                invalidRows: 0,
                unscoredRows: 0,
                corrections: { "QUICK_FIX->FEATURE": 1 },
            },
        },
    );
});
