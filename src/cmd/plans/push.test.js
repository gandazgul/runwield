import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parsePlansPushArgs, pushPlanRevision, runPlansPushCommand } from "./push.js";

function sharedResource(overrides = {}) {
    return {
        name: "demo-plan",
        planName: "demo-plan",
        path: "/repo/plans/demo-plan.md",
        planId: "plan-1",
        attrs: {
            planId: "plan-1",
            status: "draft",
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Demo Push Plan",
            createdAt: "2026-07-04T00:00:00.000Z",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example/root",
            collaborationSpaceId: "space-1",
            collaborationRevision: 2,
            collaborationBodyHash: "hash:old body",
            collaborationSyncedAt: "2026-07-04T00:00:00.000Z",
            ...overrides,
        },
        body: "new body",
    };
}

function remoteSpace(overrides = {}) {
    return {
        spaceId: "space-1",
        planId: "plan-1",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
        latestRevision: 2,
        status: "open",
        ...overrides,
    };
}

/** @param {Record<string, any>} [overrides] */
function fakePushDeps(overrides = {}) {
    const calls = {
        encryptedPayload: /** @type {any} */ (undefined),
        appendPayload: /** @type {any} */ (undefined),
        metadata: /** @type {any} */ (undefined),
        commentsByRevision: /** @type {Record<number, any[]>} */ ({
            2: [{ id: "comment-1", body: "old revision comment" }],
            3: [],
        }),
    };
    const resource = overrides.resource || sharedResource();
    const secretRecord = overrides.secretRecord === undefined
        ? {
            record: {
                planId: "plan-1",
                spaceId: "space-1",
                contentKey: "content-key-secret",
                reviewerCapability: "reviewer-cap-secret",
                maintainerCapability: "maintainer-cap-secret",
                updatedAt: "2026-07-04T00:00:00.000Z",
            },
        }
        : overrides.secretRecord;
    const deps = {
        cwd: "/repo",
        now: "2026-07-04T12:00:00.000Z",
        listPlanResources: () => Promise.resolve([resource]),
        getGlobalSecretStorePath: () => "/global/secrets.json",
        getProjectSecretStorePath: () => "/repo/.wld/collaboration-secrets.json",
        resolvePullSecretRecord: () => Promise.resolve(secretRecord),
        normalizePlanServerUrl: (/** @type {unknown} */ value) => String(value).replace(/\/$/, ""),
        hashPlanBody: (/** @type {string} */ body) => Promise.resolve(`hash:${body}`),
        importContentKey: (/** @type {string} */ key) => Promise.resolve(`imported:${key}`),
        encryptJsonPayload: (/** @type {any} */ payload, /** @type {string} */ key) => {
            calls.encryptedPayload = { payload, key };
            return Promise.resolve("ciphertext-secret");
        },
        createCollaborationClient: (/** @type {{ bearerCapability?: string }} */ options) => ({
            getSharedSpace: (/** @type {string} */ _spaceId) => {
                if (overrides.spaceError) return Promise.reject(overrides.spaceError);
                return Promise.resolve(overrides.spaceResponse || remoteSpace(overrides.space));
            },
            appendRevision: (/** @type {string} */ spaceId, /** @type {any} */ payload) => {
                calls.appendPayload = { spaceId, payload, bearerCapability: options.bearerCapability };
                if (overrides.appendError) return Promise.reject(overrides.appendError);
                return Promise.resolve({
                    revision: {
                        spaceId,
                        revision: overrides.appendedRevision || 3,
                        createdAt: "2026-07-04T12:00:00.000Z",
                        payloadCiphertext: payload.payloadCiphertext,
                    },
                });
            },
            listComments: (/** @type {string} */ _spaceId, /** @type {number} */ revision) =>
                Promise.resolve({ comments: calls.commentsByRevision[revision] || [] }),
        }),
        updatePlanCollaborationMetadata: (
            /** @type {string} */ _cwd,
            /** @type {string} */ planName,
            /** @type {any} */ updates,
            /** @type {symbol} */ bypass,
            /** @type {any} */ options,
        ) => {
            calls.metadata = { planName, updates, bypass, options };
            if (overrides.metadataError) return Promise.reject(overrides.metadataError);
            return Promise.resolve(updates);
        },
        buildCollaborationUrl: (/** @type {any} */ value) =>
            `${value.serverUrl}/p/${value.spaceId}#key=${value.contentKey}&cap=${value.bearerCapability}&role=${value.role}`,
        ...overrides.deps,
    };
    return { deps, calls };
}

/** @param {() => Promise<void>} fn */
async function captureLogs(fn) {
    const logs = /** @type {string[]} */ ([]);
    const original = console.log;
    console.log = (message = "") => logs.push(String(message));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return logs;
}

Deno.test("parsePlansPushArgs accepts plan server and project secrets", () => {
    assertEquals(parsePlansPushArgs(["demo", "--plan-server", "https://plans.example", "--project-secrets"]), {
        target: "demo",
        planServer: "https://plans.example",
        projectSecrets: true,
        help: false,
    });
    assertEquals(
        parsePlansPushArgs(["--plan-server=https://plans.example", "demo"]).planServer,
        "https://plans.example",
    );
});

Deno.test("parsePlansPushArgs requires exactly one target", () => {
    assertThrows(() => parsePlansPushArgs([]), Error, "Missing Plan");
    assertThrows(() => parsePlansPushArgs(["one", "two"]), Error, "Unexpected push argument");
});

Deno.test("pushPlanRevision appends a safe new encrypted revision and refreshes local metadata", async () => {
    const { deps, calls } = fakePushDeps();
    const result = await pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps);

    assertEquals(result.revision, 3);
    assertEquals(calls.encryptedPayload.key, "imported:content-key-secret");
    assertEquals(calls.encryptedPayload.payload.body, "new body");
    assertEquals(calls.encryptedPayload.payload.planId, "plan-1");
    assertEquals(calls.appendPayload, {
        spaceId: "space-1",
        payload: { payloadCiphertext: "ciphertext-secret", expectedRevision: 3 },
        bearerCapability: "maintainer-cap-secret",
    });
    assertEquals(calls.metadata.planName, "demo-plan");
    assertEquals(calls.metadata.updates.collaborationRevision, 3);
    assertEquals(calls.metadata.updates.collaborationBodyHash, "hash:new body");
    assertEquals(calls.metadata.options, { body: "new body" });
});

Deno.test("runPlansPushCommand prints reviewer link but not maintainer secrets", async () => {
    const { deps } = fakePushDeps();
    const logs = await captureLogs(() => runPlansPushCommand(["demo-plan"], { __testDeps: deps }));
    const output = logs.join("\n");

    assertStringIncludes(output, "revision 3");
    assertStringIncludes(output, "role=reviewer");
    assert(!output.includes("maintainer-cap-secret"));
});

Deno.test("runPlansPushCommand explains when reviewer URL cannot be reconstructed", async () => {
    const { deps } = fakePushDeps({
        secretRecord: {
            record: {
                planId: "plan-1",
                spaceId: "space-1",
                contentKey: "content-key-secret",
                maintainerCapability: "maintainer-cap-secret",
                updatedAt: "2026-07-04T00:00:00.000Z",
            },
        },
    });
    const logs = await captureLogs(() => runPlansPushCommand(["demo-plan"], { __testDeps: deps }));
    assert(logs.some((message) => message.includes("does not have reviewer secrets")));
});

Deno.test("pushPlanRevision rejects unshared or incomplete local Plans", async () => {
    const { deps } = fakePushDeps({ resource: sharedResource({ collaborationState: undefined }) });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "remote-canonical",
    );
});

Deno.test("pushPlanRevision rejects missing maintainer secrets", async () => {
    const { deps } = fakePushDeps({ secretRecord: { record: { contentKey: "content-key-secret" } } });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "maintainer secrets are missing",
    );
});

Deno.test("pushPlanRevision uses project secret lookup first when requested", async () => {
    const pathsSeen = /** @type {string[][]} */ ([]);
    const { deps } = fakePushDeps({
        deps: {
            resolvePullSecretRecord: (/** @type {string[]} */ paths) => {
                pathsSeen.push(paths);
                return Promise.resolve({
                    record: {
                        planId: "plan-1",
                        spaceId: "space-1",
                        contentKey: "content-key-secret",
                        maintainerCapability: "maintainer-cap-secret",
                        updatedAt: "2026-07-04T00:00:00.000Z",
                    },
                });
            },
        },
    });

    await pushPlanRevision({ target: "demo-plan", cwd: "/repo", projectSecrets: true }, deps);

    assertEquals(pathsSeen[0], ["/repo/.wld/collaboration-secrets.json", "/global/secrets.json"]);
});

Deno.test("pushPlanRevision reports deleted or unauthorized remote states without leaking secrets", async () => {
    const { deps } = fakePushDeps({
        spaceError: new Error("Plan Server error 404: deleted Authorization: Bearer maintainer-cap-secret"),
    });
    const error = await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "Unable to fetch remote Shared Space",
    );

    assertStringIncludes(error.message, "404");
    assert(!error.message.includes("maintainer-cap-secret"));
});

Deno.test("pushPlanRevision rejects stale remote revisions", async () => {
    const { deps } = fakePushDeps({ space: { latestRevision: 3 } });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "Run `wld plans pull` before pushing",
    );
});

Deno.test("pushPlanRevision rejects local metadata ahead of remote", async () => {
    const { deps } = fakePushDeps({ space: { latestRevision: 1 } });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "newer than the remote Shared Space",
    );
});

Deno.test("pushPlanRevision rejects closed remote Shared Spaces", async () => {
    const { deps } = fakePushDeps({ space: { status: "closed" } });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "closed",
    );
});

Deno.test("pushPlanRevision rejects unchanged no-op pushes", async () => {
    const { deps } = fakePushDeps({ resource: sharedResource({ collaborationBodyHash: "hash:new body" }) });
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "duplicate no-op revision",
    );
});

Deno.test("pushPlanRevision rejects metadata server overrides that would rebind the Plan", async () => {
    const { deps } = fakePushDeps();
    await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo", planServer: "https://other.example" }, deps),
        Error,
        "does not match",
    );
});

Deno.test("pushPlanRevision reports partial success if local metadata update fails", async () => {
    const { deps } = fakePushDeps({ metadataError: new Error("write failed maintainer-cap-secret") });
    const error = await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "Remote revision 3 was appended",
    );
    assertStringIncludes(error.message, "wld plans pull demo-plan");
    assert(!error.message.includes("maintainer-cap-secret"));
});

Deno.test("pushPlanRevision redacts secrets from remote append errors", async () => {
    const { deps } = fakePushDeps({
        appendError: new Error("Authorization: Bearer maintainer-cap-secret failed on ciphertext-secret"),
    });
    const error = await assertRejects(
        () => pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "Unable to append remote revision",
    );
    assert(!error.message.includes("maintainer-cap-secret"));
    assert(!error.message.includes("ciphertext-secret"));
});

Deno.test("pushPlanRevision does not inherit old revision comments onto the new revision", async () => {
    const { deps, calls } = fakePushDeps();
    await pushPlanRevision({ target: "demo-plan", cwd: "/repo" }, deps);
    const client = deps.createCollaborationClient({ bearerCapability: "maintainer-cap-secret" });

    assertEquals(await client.listComments("space-1", 2), {
        comments: [{ id: "comment-1", body: "old revision comment" }],
    });
    assertEquals(await client.listComments("space-1", 3), { comments: [] });
    assertEquals(calls.appendPayload.payload.expectedRevision, 3);
});
