import { assertEquals } from "@std/assert";
import { createSessionSnapshotWindow } from "./session-snapshot-window.ts";

interface FakeSnapshot {
    n: number;
}

Deno.test("snapshot window reuses one snapshot inside the TTL", () => {
    let calls = 0;
    const current: FakeSnapshot | null = { n: 1 };
    const window = createSessionSnapshotWindow<FakeSnapshot>(
        {
            getSessionSnapshot: () => {
                calls += 1;
                return current;
            },
        },
        () => "session-one",
        60_000,
    );

    const first = window.read();
    const second = window.read();
    assertEquals(calls, 1);
    assertEquals(second, first);
    assertEquals(first, { n: 1 });
});

Deno.test("snapshot window refreshes after invalidate", () => {
    let calls = 0;
    const window = createSessionSnapshotWindow<FakeSnapshot>(
        {
            getSessionSnapshot: () => {
                calls += 1;
                return { n: calls };
            },
        },
        () => "session-one",
        60_000,
    );

    assertEquals(window.read(), { n: 1 });
    window.invalidate();
    assertEquals(window.read(), { n: 2 });
    assertEquals(calls, 2);
});

Deno.test("snapshot window tracks session switches through the id reader", () => {
    let sessionId = "session-one";
    const seen: string[] = [];
    const window = createSessionSnapshotWindow<FakeSnapshot>(
        {
            getSessionSnapshot: (id: string) => {
                seen.push(id);
                return { n: 1 };
            },
        },
        () => sessionId,
        0,
    );

    window.read();
    sessionId = "session-two";
    window.read();
    assertEquals(seen, ["session-one", "session-two"]);
});
