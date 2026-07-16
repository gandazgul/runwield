import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parsePlansUnshareArgs, runPlansUnshareCommand, unsharePlan } from "./unshare.js";

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
            summary: "Demo Unshare Plan",
            createdAt: "2026-07-04T00:00:00.000Z",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example/root",
            collaborationSpaceId: "space-1",
            collaborationRevision: 2,
            collaborationBodyHash: "hash:body",
            collaborationSyncedAt: "2026-07-04T00:00:00.000Z",
            ...overrides,
        },
        body: "body",
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
function fakeUnshareDeps(overrides = {}) {
    const calls = {
        lifecycle: /** @type {any} */ (undefined),
        secretCleanup: /** @type {any} */ (undefined),
        metadata: /** @type {any} */ (undefined),
        confirmMessages: /** @type {string[]} */ ([]),
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
        resolveCompatibleSecretRecord: () => Promise.resolve(secretRecord),
        normalizePlanServerUrl: (/** @type {unknown} */ value) => String(value).replace(/\/$/, ""),
        confirm: (/** @type {string} */ message) => {
            calls.confirmMessages.push(message);
            return Promise.resolve(overrides.confirmResult ?? true);
        },
        createCollaborationClient: (/** @type {{ bearerCapability?: string }} */ options) => ({
            getSharedSpace: (/** @type {string} */ _spaceId) => {
                if (overrides.spaceError) return Promise.reject(overrides.spaceError);
                return Promise.resolve(overrides.spaceResponse || remoteSpace(overrides.space));
            },
            updateSharedSpaceLifecycle: (/** @type {string} */ spaceId, /** @type {any} */ payload) => {
                calls.lifecycle = { spaceId, payload, bearerCapability: options.bearerCapability };
                if (overrides.deleteError) return Promise.reject(overrides.deleteError);
                return Promise.resolve({ deleted: true, spaceId });
            },
        }),
        deleteCompatibleSecretRecords: (
            /** @type {string[]} */ paths,
            /** @type {string} */ planId,
            /** @type {string} */ spaceId,
        ) => {
            calls.secretCleanup = { paths, planId, spaceId };
            if (overrides.secretCleanupError) return Promise.reject(overrides.secretCleanupError);
            return Promise.resolve([{ path: paths[0], key: `${planId}:${spaceId}` }, { path: paths[1], key: planId }]);
        },
        clearPlanCollaborationMetadata: (
            /** @type {string} */ cwd,
            /** @type {string} */ planName,
            /** @type {symbol} */ bypass,
            /** @type {any} */ options,
        ) => {
            calls.metadata = { cwd, planName, bypass, options };
            if (overrides.metadataError) return Promise.reject(overrides.metadataError);
            return Promise.resolve({ planId: "plan-1" });
        },
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

Deno.test("parsePlansUnshareArgs accepts plan server, project secrets, and force", () => {
    assertEquals(
        parsePlansUnshareArgs(["demo", "--plan-server", "https://plans.example", "--project-secrets", "--force"]),
        {
            target: "demo",
            planServer: "https://plans.example",
            projectSecrets: true,
            force: true,
            help: false,
        },
    );
    assertEquals(
        parsePlansUnshareArgs(["--plan-server=https://plans.example", "demo"]).planServer,
        "https://plans.example",
    );
});

Deno.test("parsePlansUnshareArgs requires exactly one target", () => {
    assertThrows(() => parsePlansUnshareArgs([]), Error, "Missing Plan");
    assertThrows(() => parsePlansUnshareArgs(["one", "two"]), Error, "Unexpected unshare argument");
});

Deno.test("unsharePlan deletes remote space and clears local state after confirmation", async () => {
    const { deps, calls } = fakeUnshareDeps();
    const result = await unsharePlan({ target: "demo-plan", cwd: "/repo" }, deps);

    assertEquals(result.spaceId, "space-1");
    assertEquals(result.deletedSecretCount, 2);
    assertEquals(calls.confirmMessages.length, 1);
    assertStringIncludes(calls.confirmMessages[0], "Reviewer and maintainer links will stop working");
    assertEquals(calls.lifecycle, {
        spaceId: "space-1",
        payload: { action: "delete" },
        bearerCapability: "maintainer-cap-secret",
    });
    assertEquals(calls.secretCleanup, {
        paths: ["/global/secrets.json", "/repo/.wld/collaboration-secrets.json"],
        planId: "plan-1",
        spaceId: "space-1",
    });
    assertEquals(calls.metadata.planName, "demo-plan");
    assertEquals(calls.metadata.options, { updatedAt: "2026-07-04T12:00:00.000Z" });
});

Deno.test("unsharePlan force skips confirmation but not cleanup", async () => {
    const { deps, calls } = fakeUnshareDeps();
    await unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps);

    assertEquals(calls.confirmMessages.length, 0);
    assertEquals(calls.lifecycle.spaceId, "space-1");
    assertEquals(calls.metadata.planName, "demo-plan");
});

Deno.test("unsharePlan cancels without deleting or cleaning local state", async () => {
    const { deps, calls } = fakeUnshareDeps({ confirmResult: false });
    await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo" }, deps),
        Error,
        "Unshare cancelled",
    );

    assertEquals(calls.lifecycle, undefined);
    assertEquals(calls.secretCleanup, undefined);
    assertEquals(calls.metadata, undefined);
});

Deno.test("unsharePlan rejects unshared or incomplete local Plans", async () => {
    const { deps } = fakeUnshareDeps({ resource: sharedResource({ collaborationState: undefined }) });
    await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "remote-canonical",
    );
});

Deno.test("unsharePlan rejects missing maintainer secrets", async () => {
    const { deps } = fakeUnshareDeps({ secretRecord: { record: { contentKey: "content-key-secret" } } });
    await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "maintainer secrets are missing",
    );
});

Deno.test("unsharePlan uses project secret lookup first when requested", async () => {
    const pathsSeen = /** @type {string[][]} */ ([]);
    const { deps } = fakeUnshareDeps({
        deps: {
            resolveCompatibleSecretRecord: (/** @type {string[]} */ paths) => {
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

    await unsharePlan({ target: "demo-plan", cwd: "/repo", projectSecrets: true, force: true }, deps);

    assertEquals(pathsSeen[0], ["/repo/.wld/collaboration-secrets.json", "/global/secrets.json"]);
});

Deno.test("unsharePlan rejects server overrides that would rebind the Plan", async () => {
    const { deps } = fakeUnshareDeps();
    await assertRejects(
        () =>
            unsharePlan({ target: "demo-plan", cwd: "/repo", planServer: "https://other.example", force: true }, deps),
        Error,
        "does not match",
    );
});

Deno.test("unsharePlan handles already-deleted remotes as explicit local cleanup", async () => {
    const error = new Error("Plan Server error 404: Shared Space not found or deleted");
    /** @type {any} */ (error).status = 404;
    const { deps, calls } = fakeUnshareDeps({ spaceError: error });
    const result = await unsharePlan({ target: "demo-plan", cwd: "/repo" }, deps);

    assertEquals(result.alreadyDeleted, true);
    assertEquals(calls.confirmMessages.length, 1);
    assertStringIncludes(calls.confirmMessages[0], "already-deleted");
    assertEquals(calls.lifecycle, undefined);
    assertEquals(calls.metadata.planName, "demo-plan");
});

Deno.test("unsharePlan treats delete-time 404 as already-deleted recovery", async () => {
    const error = new Error("Plan Server error 404: Shared Space not found or deleted");
    /** @type {any} */ (error).status = 404;
    const { deps, calls } = fakeUnshareDeps({ deleteError: error });
    const result = await unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps);

    assertEquals(result.alreadyDeleted, true);
    assertEquals(calls.metadata.planName, "demo-plan");
});

Deno.test("unsharePlan requires separate cleanup confirmation after delete-time 404", async () => {
    const error = new Error("Plan Server error 404: Shared Space not found or deleted");
    /** @type {any} */ (error).status = 404;
    const { deps, calls } = fakeUnshareDeps({ deleteError: error });
    const result = await unsharePlan({ target: "demo-plan", cwd: "/repo" }, deps);

    assertEquals(result.alreadyDeleted, true);
    assertEquals(calls.confirmMessages.length, 2);
    assertStringIncludes(calls.confirmMessages[1], "already-deleted");
    assertEquals(calls.metadata.planName, "demo-plan");
});

Deno.test("unsharePlan leaves local state locked after ambiguous network failures", async () => {
    const { deps, calls } = fakeUnshareDeps({ spaceError: new Error("Network failure calling maintainer-cap-secret") });
    const error = await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "local collaboration metadata was not changed",
    );

    assert(!error.message.includes("maintainer-cap-secret"));
    assertEquals(calls.lifecycle, undefined);
    assertEquals(calls.secretCleanup, undefined);
    assertEquals(calls.metadata, undefined);
});

Deno.test("unsharePlan does not treat network not-found wording as deleted", async () => {
    const { deps, calls } = fakeUnshareDeps({ spaceError: new Error("Network failure: DNS host not found") });
    await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "local collaboration metadata was not changed",
    );

    assertEquals(calls.secretCleanup, undefined);
    assertEquals(calls.metadata, undefined);
});

Deno.test("unsharePlan leaves local state locked after ambiguous delete failures", async () => {
    const { deps, calls } = fakeUnshareDeps({ deleteError: new Error("Plan Server error 500: maintainer-cap-secret") });
    const error = await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "Remote delete result is ambiguous",
    );

    assert(!error.message.includes("maintainer-cap-secret"));
    assertEquals(calls.secretCleanup, undefined);
    assertEquals(calls.metadata, undefined);
});

Deno.test("unsharePlan rejects wrong capability without local cleanup", async () => {
    const error = new Error("Plan Server error 403: Authorization: Bearer maintainer-cap-secret denied");
    /** @type {any} */ (error).status = 403;
    const { deps, calls } = fakeUnshareDeps({ spaceError: error });
    const thrown = await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "Unable to fetch remote Shared Space",
    );

    assert(!thrown.message.includes("maintainer-cap-secret"));
    assertEquals(calls.secretCleanup, undefined);
    assertEquals(calls.metadata, undefined);
});

Deno.test("unsharePlan reports partial cleanup when local secret cleanup fails", async () => {
    const { deps } = fakeUnshareDeps({ secretCleanupError: new Error("write failed maintainer-cap-secret") });
    const error = await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "local collaboration secret cleanup failed",
    );

    assert(!error.message.includes("maintainer-cap-secret"));
});

Deno.test("unsharePlan reports partial cleanup when metadata clearing fails", async () => {
    const { deps } = fakeUnshareDeps({ metadataError: new Error("write failed maintainer-cap-secret") });
    const error = await assertRejects(
        () => unsharePlan({ target: "demo-plan", cwd: "/repo", force: true }, deps),
        Error,
        "local collaboration metadata cleanup failed",
    );

    assertStringIncludes(error.message, "2 local secret record");
    assert(!error.message.includes("maintainer-cap-secret"));
});

Deno.test("runPlansUnshareCommand prints success without maintainer secrets", async () => {
    const { deps } = fakeUnshareDeps();
    const logs = await captureLogs(() => runPlansUnshareCommand(["demo-plan", "--force"], { __testDeps: deps }));
    const output = logs.join("\n");

    assertStringIncludes(output, "Unshared demo-plan");
    assertStringIncludes(output, "Removed 2 local collaboration secret record");
    assert(!output.includes("maintainer-cap-secret"));
    assert(!output.includes("content-key-secret"));
});
