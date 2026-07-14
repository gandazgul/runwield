/**
 * @module acp/session-map.test
 */

import { assert, assertEquals } from "@std/assert";
import { AcpSessionMap } from "./session-map.js";

Deno.test("AcpSessionMap correlates runtime-owned turns without enforcing exclusion", () => {
    const sessionMap = new AcpSessionMap();
    sessionMap.createRecord(/** @type {any} */ ({ id: "hosted-1", cwd: "/repo" }), {
        acpSessionId: "acp-1",
    });

    const first = sessionMap.beginPrompt("acp-1", "turn-1", "request-1");
    const second = sessionMap.beginPrompt("acp-1", "turn-2", "request-2");
    assert(first);
    assert(second);
    assertEquals(sessionMap.isCurrentPrompt("acp-1", first), false);
    assertEquals(sessionMap.isCurrentPrompt("acp-1", second), true);
    assertEquals(sessionMap.endPrompt("acp-1", first), false);
    assertEquals(sessionMap.markCancelled("acp-1"), true);
    assertEquals(second.cancelled, true);
    assertEquals(sessionMap.endPrompt("acp-1", second), true);
});
