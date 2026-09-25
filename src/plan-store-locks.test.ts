import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { listPlanResources, savePlan, withPlanCatalogLock, withPlanLock } from "./plan-store.js";
import { resolveProjectRuntimeLayout } from "./shared/project-runtime-layout.ts";

async function promptly<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("Plan operation waited on an unrelated lock")), 3_000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

Deno.test({
    name: "Plan writers reclaim abandoned locks even while the recorded process is alive",
    ignore: Deno.build.os === "windows",
    async fn() {
        const root = await Deno.makeTempDir({ prefix: "rw-abandoned-plan-lock-" });
        try {
            await savePlan(root, "demo", "# Demo\n", { planId: "demo" });
            const layout = resolveProjectRuntimeLayout(root);
            for (const name of ["demo.lock", "catalog.lock"]) {
                const path = join(layout.selected.planLocksDir, name);
                const past = new Date(Date.now() - 60_000);
                await Deno.writeTextFile(
                    path,
                    JSON.stringify({
                        token: "abandoned",
                        pid: Deno.pid,
                        hostname: Deno.hostname(),
                        updatedAtMs: past.getTime(),
                    }),
                );
                await Deno.utime(path, past, past);
                const operation = name === "catalog.lock"
                    ? withPlanCatalogLock(root, () => Promise.resolve("acquired"))
                    : withPlanLock(root, "demo", () => Promise.resolve("acquired"));
                try {
                    assertEquals(await promptly(operation), "acquired");
                } finally {
                    // Also release the pre-fix waiter, so a failing regression never
                    // leaves a five-minute task behind in the isolated test process.
                    await Deno.remove(path).catch(() => {});
                    await operation;
                }
            }
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    },
});

Deno.test({
    name: "Plan writers never reclaim an operating-system lock just because its heartbeat is old",
    ignore: Deno.build.os === "windows",
    async fn() {
        const root = await Deno.makeTempDir({ prefix: "rw-held-plan-lock-" });
        try {
            await savePlan(root, "demo", "# Demo\n", { planId: "demo" });
            const path = join(resolveProjectRuntimeLayout(root).selected.planLocksDir, "demo.lock");
            const past = new Date(Date.now() - 60_000);
            const owner = JSON.stringify({
                token: "still-held",
                pid: Deno.pid,
                hostname: Deno.hostname(),
                updatedAtMs: past.getTime(),
            });
            await Deno.writeTextFile(path, owner);
            await Deno.utime(path, past, past);
            const file = await Deno.open(path, { read: true, write: true });
            file.lockSync(true);
            let acquired = false;
            const operation = withPlanLock(root, "demo", () => {
                acquired = true;
                return Promise.resolve();
            });
            try {
                await new Promise((resolve) => setTimeout(resolve, 150));
                assertEquals(acquired, false);
                assertEquals(await Deno.readTextFile(path), owner);
            } finally {
                file.close();
                // The orphan is intentionally left for ordinary acquisition to repair.
                try {
                    await promptly(operation);
                } finally {
                    await Deno.remove(path).catch(() => {});
                    await operation;
                }
            }
        } finally {
            await Deno.remove(root, { recursive: true });
        }
    },
});

Deno.test("Plan catalog reads remain available during a writer while identity backfills serialize", async () => {
    const root = await Deno.makeTempDir({ prefix: "rw-catalog-read-" });
    let release = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => entered = resolve);
    const finish = new Promise<void>((resolve) => release = resolve);
    try {
        await savePlan(root, "demo", "# Demo\n", { planId: "demo" });
        const writer = withPlanCatalogLock(root, async () => {
            entered();
            await finish;
        });
        await held;
        const reading = listPlanResources(root);
        let backfilled = false;
        const backfilling = listPlanResources(root, { backfillMissing: true }).then(() => backfilled = true);
        try {
            assertEquals((await promptly(reading)).map((plan) => plan.planId), ["demo"]);
            assertEquals(backfilled, false);
        } finally {
            release();
            await Promise.all([writer, reading, backfilling]);
        }
        assertEquals(backfilled, true);
    } finally {
        release();
        await Deno.remove(root, { recursive: true });
    }
});
