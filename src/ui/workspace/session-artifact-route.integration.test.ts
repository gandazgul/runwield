import { assertEquals, assertStringIncludes } from "@std/assert";
import { makeManagedSessionFixture } from "../../testing/managed-session-fixture.ts";
import { createOwnerWorkspaceApp } from "./server.js";
import { getAstroOwnerWorkspaceSessionContinuation } from "./server/astro-owner-data.js";

Deno.test("registered Session artifacts open through the owner route and reject unrelated Sessions", async () => {
    const fixture = await makeManagedSessionFixture();
    const store = fixture.openStore();
    const app = createOwnerWorkspaceApp({ mode: "owner", publicOrigin: "http://127.0.0.1:8787", store });
    try {
        await Deno.writeTextFile(`${fixture.projectRoot}/artifact.md`, "# Saved Plan\n\nArtifact route regression.\n");
        const proof = store.acquireSessionActivation({
            runwieldSessionId: fixture.session.runwieldSessionId,
            projectId: fixture.project.projectId,
            ownerInstanceId: "artifact-test",
            ownerProcessKind: "test",
            operationId: "artifact-test-op",
            expectedGeneration: 0,
        });
        const artifact = store.registerSessionArtifact(proof, {
            kind: "plan",
            path: "artifact.md",
            title: "Saved Plan",
            registeredBy: "Planner",
        });
        store.releaseUnchangedActivation(proof);
        const pairing = store.createPairingRequest();
        store.approvePairingRequest(pairing.code);
        const device = store.claimPairingRequest(pairing.proof);
        const headers = { cookie: `rw_owner_device=${encodeURIComponent(device.credential)}` };
        const sessionPath = `/projects/${fixture.project.projectId}/sessions/${fixture.session.runwieldSessionId}`;
        const response = await app.handler()(
            new Request(`http://127.0.0.1:8787${sessionPath}/artifacts/${artifact.artifactId}`, { headers }),
        );
        // Without an Astro build the route must report the build requirement, never a missing route.
        assertEquals([200, 503].includes(response.status), true);
        const built = await Deno.stat(new URL("../../../dist/workspace/server/entry.mjs", import.meta.url))
            .then(() => true).catch(() => false);
        if (built) assertEquals(response.status, 200);
        const html = await response.text();
        if (response.status === 200) {
            assertStringIncludes(html, "Saved Plan");
            assertStringIncludes(html, "Artifact route regression.");
            assertStringIncludes(html, sessionPath);
        } else assertStringIncludes(html, "Workspace build unavailable");
        const wrongSession = await app.handler()(
            new Request(
                `http://127.0.0.1:8787/projects/${fixture.project.projectId}/sessions/missing/artifacts/${artifact.artifactId}`,
                { headers },
            ),
        );
        assertEquals(wrongSession.status, 404);
    } finally {
        getAstroOwnerWorkspaceSessionContinuation()?.close();
        store.close();
        await fixture.cleanup();
    }
});
