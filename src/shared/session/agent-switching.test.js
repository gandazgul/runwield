import { assertEquals, assertRejects } from "@std/assert";
import { applyPendingRootSwap } from "./agent-switching.js";
import { HostedSession } from "./hosted-session.js";

function makePendingSession() {
    const hostedSession = new HostedSession({ id: "root-swap", cwd: Deno.cwd() });
    hostedSession.setPendingRootSwap({ agentName: "operator", displayName: "Operator" });
    return hostedSession;
}

Deno.test("applyPendingRootSwap treats disposal during a root build as shutdown", async () => {
    const hostedSession = makePendingSession();
    const messages = /** @type {string[]} */ ([]);

    await applyPendingRootSwap(
        hostedSession,
        /** @type {any} */ ({ appendSystemMessage: (/** @type {string} */ message) => messages.push(message) }),
        {
            ensureRootAgentSession: () => {
                hostedSession.dispose();
                return Promise.reject(new Error(`HostedSession "${hostedSession.id}" is disposed`));
            },
        },
    );

    assertEquals(hostedSession.disposed, true);
    assertEquals(messages, []);
});

Deno.test("applyPendingRootSwap preserves root build failures while the session is active", async () => {
    const hostedSession = makePendingSession();

    await assertRejects(
        () =>
            applyPendingRootSwap(hostedSession, undefined, {
                ensureRootAgentSession: () => Promise.reject(new Error("build failed")),
            }),
        Error,
        "build failed",
    );
});
