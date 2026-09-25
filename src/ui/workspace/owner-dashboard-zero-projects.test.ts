import { assertEquals } from "@std/assert";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { loadOwnerDashboard, subscribeOwnerDashboard } from "./server/owner-dashboard.ts";

Deno.test("Dashboard with no registered Projects completes all four empty sections", async () => {
    const dir = await Deno.makeTempDir({ prefix: "rw-dashboard-empty-" });
    const store = openOwnerCoordinationStore({ dbPath: `${dir}/owner.sqlite3` });
    const continuation = {
        operations: new Map(),
        async listSessions() {
            return { sessions: [] };
        },
    };
    try {
        const frames: Array<{ type: string; sections: Array<{ items: Array<{ planId: string }> }> }> = [];
        const unsubscribe = subscribeOwnerDashboard(store, continuation, (frame) => frames.push(frame));
        const result = await loadOwnerDashboard(store, continuation);
        unsubscribe();
        assertEquals(frames.at(-1)?.type, "complete");
        assertEquals(result.dashboard.sections.length, 4);
        assertEquals(result.dashboard.sections.every((section) => section.items.length === 0), true);
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});
