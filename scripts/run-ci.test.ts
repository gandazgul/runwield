import { assertEquals } from "@std/assert";
import { type CiTaskName, type CiTaskResult, PRE_TEST_TASKS, runCi } from "./run-ci.ts";

interface DeferredTask {
    promise: Promise<CiTaskResult>;
    resolve: (result: CiTaskResult) => void;
}

function deferredTask(): DeferredTask {
    let resolveTask: (result: CiTaskResult) => void = () => {};
    const promise = new Promise<CiTaskResult>((resolve) => {
        resolveTask = resolve;
    });
    return { promise, resolve: resolveTask };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

Deno.test("runCi starts every pre-test task before waiting and keeps test behind the barrier", async () => {
    const starts: CiTaskName[] = [];
    const tasks = new Map<CiTaskName, DeferredTask>();
    const resultPromise = runCi((taskName) => {
        starts.push(taskName);
        const deferred = deferredTask();
        tasks.set(taskName, deferred);
        return deferred.promise;
    });

    await flushPromises();
    assertEquals(starts, [...PRE_TEST_TASKS]);

    for (const taskName of PRE_TEST_TASKS.slice(0, -1)) {
        tasks.get(taskName)?.resolve({ name: taskName, code: 0 });
    }
    await flushPromises();
    assertEquals(starts, [...PRE_TEST_TASKS]);

    const lastPreTest = PRE_TEST_TASKS.at(-1);
    if (!lastPreTest) throw new Error("PRE_TEST_TASKS must not be empty");
    tasks.get(lastPreTest)?.resolve({ name: lastPreTest, code: 0 });
    await flushPromises();
    assertEquals(starts, [...PRE_TEST_TASKS, "test"]);

    tasks.get("test")?.resolve({ name: "test", code: 0 });
    assertEquals(await resultPromise, { exitCode: 0, failures: [] });
});

Deno.test("runCi starts one test after a successful pre-test wave", async () => {
    const starts: CiTaskName[] = [];
    const result = await runCi((taskName) => {
        starts.push(taskName);
        return Promise.resolve({ name: taskName, code: 0 });
    });

    assertEquals(starts, [...PRE_TEST_TASKS, "test"]);
    assertEquals(result, { exitCode: 0, failures: [] });
});

Deno.test("runCi reports all failed pre-test tasks and skips test", async () => {
    const starts: CiTaskName[] = [];
    const failed = new Map<CiTaskName, number>([
        ["lint", 2],
        ["doc-links:check", 3],
    ]);

    const result = await runCi((taskName) => {
        starts.push(taskName);
        return Promise.resolve({ name: taskName, code: failed.get(taskName) ?? 0 });
    });

    assertEquals(starts, [...PRE_TEST_TASKS]);
    assertEquals(result, {
        exitCode: 1,
        failures: [
            { name: "lint", code: 2 },
            { name: "doc-links:check", code: 3 },
        ],
    });
});

Deno.test("runCi converts a process-start error into a failed pre-test result and waits for siblings", async () => {
    const starts: CiTaskName[] = [];
    const tasks = new Map<CiTaskName, DeferredTask>();
    const resultPromise = runCi((taskName) => {
        starts.push(taskName);
        if (taskName === "snip:check") throw new Error("could not start subprocess");
        const deferred = deferredTask();
        tasks.set(taskName, deferred);
        return deferred.promise;
    });

    await flushPromises();
    assertEquals(starts, [...PRE_TEST_TASKS]);

    for (const taskName of PRE_TEST_TASKS) {
        if (taskName === "snip:check") continue;
        const exitCode = taskName === "seams:check" ? 4 : 0;
        tasks.get(taskName)?.resolve({ name: taskName, code: exitCode });
    }

    assertEquals(await resultPromise, {
        exitCode: 1,
        failures: [
            { name: "snip:check", code: 1 },
            { name: "seams:check", code: 4 },
        ],
    });
    assertEquals(starts.includes("test"), false);
});

Deno.test("runCi preserves a failed test exit code", async () => {
    const result = await runCi((taskName) =>
        Promise.resolve({
            name: taskName,
            code: taskName === "test" ? 7 : 0,
        })
    );

    assertEquals(result, {
        exitCode: 7,
        failures: [{ name: "test", code: 7 }],
    });
});
