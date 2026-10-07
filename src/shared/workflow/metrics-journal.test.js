import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import lockfile from "proper-lockfile";
import { setCustomSetting } from "../settings.js";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";
import { getWorkflowMetricsFilePath, recordWorkflowMetric } from "./metrics.js";
import { appendWorkflowMetric, resolveCollectionEpoch } from "./metrics-journal.js";

const metric = { v: 2, category: "command", event: "command_started", recorderId: "test", seq: 0, command: "help" };

/** @param {string} path */
async function readJournal(path) {
    return (await Deno.readTextFile(path)).trim().split("\n").map((line) => JSON.parse(line));
}

/** @param {string} path @param {boolean} [enabled] */
function invocation(path, enabled = true) {
    return { enabled, epoch: resolveCollectionEpoch(path).collectionEpoch.id, deadline: Date.now() + 1000 };
}

Deno.test("journal preserves opt-in and project-over-global precedence", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        await Deno.remove(join(projectRoot, ".wld", "settings.json"));
        assertEquals((await recordWorkflowMetric(metric, projectRoot)).persisted, false);
        await setCustomSetting("workflowMetrics", false, "global", projectRoot);
        assertEquals((await recordWorkflowMetric(metric, projectRoot)).persisted, false);
        await setCustomSetting("workflowMetrics", { enabled: true }, "project", projectRoot);
        assertEquals((await recordWorkflowMetric(metric, projectRoot)).persisted, true);
        await setCustomSetting("workflowMetrics", true, "global", projectRoot);
        await setCustomSetting("workflowMetrics", false, "project", projectRoot);
        assertEquals((await recordWorkflowMetric(metric, projectRoot)).persisted, false);
        assertEquals((await readMetrics()).length, 1);
    });
});

Deno.test("journal excludes invocations across disable and re-enable without replay", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await recordWorkflowMetric(metric, projectRoot);
        const startedEnabled = invocation(path);
        await setCustomSetting("workflowMetrics", false, "project", projectRoot);
        const rejected = await appendWorkflowMetric(path, projectRoot, { ...metric, eventId: "old" }, startedEnabled);
        assertEquals(rejected.persisted, false);
        assertEquals(rejected.reason, "disabled");
        const startedDisabled = invocation(path, false);
        await recordWorkflowMetric(metric, projectRoot);
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        assertEquals((await appendWorkflowMetric(path, projectRoot, metric, startedDisabled)).persisted, false);
        const stale = await appendWorkflowMetric(path, projectRoot, metric, startedEnabled);
        assertEquals(stale.reason, "collection_boundary");
        await recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
        assertEquals((await readMetrics()).length, 2);
        assertEquals(
            (await readJournal(path)).filter((row) => row.event === "collection_epoch").map((row) => row.enabled),
            [true, false, true],
        );
    });
});

Deno.test("upgrade keeps v1 bytes and unknown history without transcript replay", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await Deno.mkdir(dirname(path), { recursive: true });
        const old = '{"v":1,"event":"old","details":{"safe":true}}\n';
        await Deno.writeTextFile(path, old);
        await setCustomSetting("workflowMetrics", false, "project", projectRoot);
        await Deno.writeTextFile(join(projectRoot, "transcript.jsonl"), '{"text":"private activity"}\n');
        await recordWorkflowMetric(metric, projectRoot);
        assertEquals(await Deno.readTextFile(path), old);
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        await recordWorkflowMetric(metric, projectRoot);
        assert((await Deno.readTextFile(path)).startsWith(old));
        const rows = await readJournal(path);
        assertEquals(rows.length, 3);
        assertEquals(rows[1].event, "collection_epoch");
        assertEquals(JSON.stringify(rows).includes("private activity"), false);
        await Deno.writeTextFile(
            join(dirname(path), "state.json"),
            JSON.stringify({
                v: 1,
                collectionEpoch: { id: "stale", enabled: true },
                historyEpoch: "stale",
            }),
        );
        await recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
        const state = JSON.parse(await Deno.readTextFile(join(dirname(path), "state.json")));
        assertEquals(state.collectionEpoch.id, rows[1].collectionEpoch);
    });
});

Deno.test("contended journal skips within its budget and retry keeps observation identity", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await recordWorkflowMetric(metric, projectRoot);
        const script = join(projectRoot, "lock-holder.js");
        await Deno.writeTextFile(
            script,
            `import lockfile from "proper-lockfile";
const release = lockfile.lockSync(Deno.args[0], {realpath:false});
console.log("ready"); await Deno.stdin.read(new Uint8Array(1)); release();`,
        );
        const holder = new Deno.Command(Deno.execPath(), {
            args: [
                "run",
                "-A",
                "--config",
                new URL("../../../deno.json", import.meta.url).pathname,
                script,
                join(dirname(path), ".journal.lock"),
            ],
            stdin: "piped",
            stdout: "piped",
        }).spawn();
        const reader = holder.stdout.getReader();
        await reader.read();
        let failed;
        const start = Date.now();
        try {
            failed = await recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
            assertEquals(failed.persisted, false);
            assertEquals(failed.reason, "lock_timeout");
            assert(Date.now() - start < 1400);
        } finally {
            const writer = holder.stdin.getWriter();
            await writer.write(new Uint8Array([10]));
            await writer.close();
            writer.releaseLock();
            assertEquals((await holder.status).code, 0);
            await reader.cancel();
            reader.releaseLock();
        }
        const saved = await recordWorkflowMetric(failed, projectRoot);
        assertEquals(saved.persisted, true);
        assertEquals(saved.eventId, failed.eventId);
        assertEquals((await readJournal(path)).filter((row) => row.eventId === saved.eventId).length, 1);
    });
});

Deno.test("two processes append unique complete observations to one journal", async () => {
    await withWorkflowMetricsFixture(async ({ homeDir, projectRoot }) => {
        const script = join(projectRoot, "writer.js");
        const module = new URL("./metrics.js", import.meta.url).href;
        await Deno.writeTextFile(
            script,
            `import { recordWorkflowMetric } from ${JSON.stringify(module)};
for (let seq = 0; seq < 12; seq++) {
const result = await recordWorkflowMetric({ v:2, category:"command", event:"command_started", recorderId:Deno.args[1], seq, command:"help" }, Deno.args[0]);
if (!result.persisted) throw new Error(result.reason);
}`,
        );
        const results = await Promise.all(
            ["one", "two"].map((id) =>
                new Deno.Command(Deno.execPath(), {
                    args: [
                        "run",
                        "-A",
                        "--config",
                        new URL("../../../deno.json", import.meta.url).pathname,
                        script,
                        projectRoot,
                        id,
                    ],
                    env: { HOME: homeDir },
                    stdout: "piped",
                    stderr: "piped",
                }).output()
            ),
        );
        for (const result of results) assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
        const observations = (await readJournal(getWorkflowMetricsFilePath(projectRoot))).filter((row) => row.v === 2);
        assertEquals(observations.length, 24);
        assertEquals(new Set(observations.map((row) => row.eventId)).size, 24);
    });
});

Deno.test("kill and restart repairs incomplete final evidence without losing earlier records", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        const first = await recordWorkflowMetric(metric, projectRoot);
        const script = join(projectRoot, "torn.js");
        await Deno.writeTextFile(
            script,
            `const file = Deno.openSync(Deno.args[0], {write:true, append:true});
file.writeSync(new TextEncoder().encode('{"v":2,"eventId":"incomplete'));
file.syncSync(); console.log("ready"); await new Promise(() => {});`,
        );
        const child = new Deno.Command(Deno.execPath(), { args: ["run", "-A", script, path], stdout: "piped" }).spawn();
        const reader = child.stdout.getReader();
        await reader.read();
        child.kill("SIGKILL");
        await child.status;
        await reader.cancel();
        reader.releaseLock();
        const next = await recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
        assertEquals(next.persisted, true);
        const rows = await readJournal(path);
        assertEquals(rows.filter((row) => row.eventId === first.eventId).length, 1);
        assertEquals(rows.filter((row) => row.event === "measurement_gap")[0].reason, "incomplete_append");
        assertEquals(rows.filter((row) => row.v === 2).length, 2);
    });
});

Deno.test("interior corruption stays isolated with an explicit coverage gap", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await recordWorkflowMetric(metric, projectRoot);
        await Deno.writeTextFile(path, 'broken-interior\n{"v":1,"event":"legacy"}\n', { append: true });
        const result = await recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
        assertEquals(result.persisted, true);
        assert(result.coverageGap);
        assertEquals(result.coverageGap.corruptLines, [3]);
        const text = await Deno.readTextFile(path);
        assert(text.includes('broken-interior\n{"v":1,"event":"legacy"}\n'));
        assert(text.includes('"reason":"interior_corruption"'));
    });
});

Deno.test("disk failure returns not-persisted evidence and never throws", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.mkdir(path);
        const result = await appendWorkflowMetric(path, projectRoot, metric, {
            enabled: true,
            epoch: "initial",
            deadline: Date.now() + 1000,
        });
        assertEquals(result.persisted, false);
        assertEquals(result.reason, "storage_failure");
    });
});

Deno.test("pending recorder rechecks settings after acquiring the journal lock", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        await recordWorkflowMetric(metric, projectRoot);
        const release = lockfile.lockSync(join(dirname(path), ".journal.lock"), { realpath: false });
        const pending = recordWorkflowMetric({ ...metric, seq: 1 }, projectRoot);
        try {
            await new Promise((resolve) => setTimeout(resolve, 40));
            await setCustomSetting("workflowMetrics", false, "project", projectRoot);
        } finally {
            release();
        }
        assertEquals((await pending).persisted, false);
        const secondRelease = lockfile.lockSync(join(dirname(path), ".journal.lock"), { realpath: false });
        const disabled = recordWorkflowMetric({ ...metric, seq: 2 }, projectRoot);
        try {
            await new Promise((resolve) => setTimeout(resolve, 40));
            await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        } finally {
            secondRelease();
        }
        assertEquals((await disabled).persisted, false);
        assertEquals((await readMetrics()).length, 1);
    });
});

Deno.test("first enabled invocation that settles disabled creates a rejecting boundary", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot }) => {
        const path = getWorkflowMetricsFilePath(projectRoot);
        const started = invocation(path);
        await setCustomSetting("workflowMetrics", false, "project", projectRoot);
        const failed = await appendWorkflowMetric(path, projectRoot, { ...metric, eventId: "first" }, started);
        assertEquals(failed.persisted, false);
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        const retried = await recordWorkflowMetric(failed, projectRoot);
        assertEquals(retried.persisted, false);
        assertEquals(retried.eventId, "first");
        assertEquals((await readJournal(path)).map((row) => row.enabled), [false, true]);
    });
});
