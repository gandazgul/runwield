import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parsePlansShareArgs, runPlansShareCommand } from "./share.js";

/** @param {Record<string, unknown>} [overrides] */
function activeResource(overrides = {}) {
    return {
        name: "demo-plan",
        planName: "demo-plan",
        relativePath: "plans/demo-plan.md",
        path: "/repo/plans/demo-plan.md",
        planId: "plan-1",
        attrs: {
            planId: "plan-1",
            status: "approved",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Demo Plan",
            createdAt: "2026-07-04T00:00:00.000Z",
            ...overrides,
        },
        body: "# Demo\n\nBody text",
        markdown: "---\nplanId: plan-1\n---\n# Demo\n\nBody text",
    };
}

/** @param {any} [overrides] */
function fakeShareDeps(overrides = {}) {
    const calls = {
        createPayload: /** @type {any} */ (undefined),
        authHeaders: /** @type {string[]} */ ([]),
        secretPath: "",
        secretKey: "",
        secretRecord: /** @type {any} */ (undefined),
        metadata: /** @type {any} */ (undefined),
        cleanupActions: /** @type {string[]} */ ([]),
        deletedSecrets: /** @type {Array<{ path: string, key: string }>} */ ([]),
        ignoredProjectRoot: "",
        encryptedPayload: /** @type {any} */ (undefined),
    };
    const resource = overrides.resource || activeResource();
    const deps = {
        cwd: "/repo",
        now: "2026-07-04T12:00:00.000Z",
        loadPlan: (/** @type {string} */ _cwd, /** @type {string} */ target) =>
            Promise.resolve(target === resource.name ? { attrs: resource.attrs, body: resource.body } : null),
        ensurePlanIdentity: (/** @type {string} */ _cwd, /** @type {string} */ _target) => Promise.resolve(resource),
        listPlanResources: () => Promise.resolve(resource.planId ? [resource] : []),
        getDefaultPlanServerUrl: () => "https://configured.example/root",
        normalizePlanServerUrl: (/** @type {unknown} */ value) => {
            const url = new URL(String(value));
            if (url.hash || url.search) throw new Error("bad server url");
            url.pathname = url.pathname.replace(/\/+$/, "");
            return url.toString().replace(/\/$/, "");
        },
        generateContentKey: () => Promise.resolve("crypto-key"),
        exportContentKey: (/** @type {unknown} */ key) => Promise.resolve(`exported-${key}`),
        encryptJsonPayload: (/** @type {unknown} */ payload, /** @type {unknown} */ _key) => {
            calls.encryptedPayload = payload;
            return Promise.resolve("ciphertext-only");
        },
        generateBearerCapability: (() => {
            const values = ["reviewer-raw-cap", "maintainer-raw-cap"];
            return () => values.shift() || "extra-cap";
        })(),
        hashCapability: (/** @type {string} */ capability) =>
            Promise.resolve(capability.startsWith("reviewer") ? "sha256:reviewer-hash" : "sha256:maintainer-hash"),
        createCollaborationClient: (/** @type {{ bearerCapability?: string }} */ options) => ({
            createSharedSpace: (/** @type {any} */ payload) => {
                calls.createPayload = payload;
                if (options.bearerCapability) calls.authHeaders.push(options.bearerCapability);
                if (overrides.createFails) return Promise.reject(new Error("create failed"));
                return Promise.resolve({
                    spaceId: "space-1",
                    planId: payload.planId,
                    latestRevision: 1,
                    status: "open",
                    createdAt: "2026-07-04T12:00:00.000Z",
                    updatedAt: "2026-07-04T12:00:00.000Z",
                });
            },
            updateSharedSpaceLifecycle: (
                /** @type {string} */ _spaceId,
                /** @type {{ action: string }} */ lifecycle,
            ) => {
                calls.cleanupActions.push(lifecycle.action);
                if (overrides.cleanupFails) return Promise.reject(new Error("cleanup cap=maintainer-raw-cap failed"));
                return Promise.resolve({ ok: true });
            },
        }),
        getGlobalSecretStorePath: () => "/home/user/.wld/collaboration-secrets.json",
        getProjectSecretStorePath: (/** @type {string} */ cwd) => `${cwd}/.wld/collaboration-secrets.json`,
        ensureProjectSecretStoreIgnored: (/** @type {string} */ cwd) => {
            calls.ignoredProjectRoot = cwd;
            return Promise.resolve();
        },
        getSecretRecord: () => Promise.resolve(overrides.existingSecret),
        putSecretRecord: (/** @type {string} */ path, /** @type {string} */ key, /** @type {any} */ record) => {
            calls.secretPath = path;
            calls.secretKey = key;
            calls.secretRecord = record;
            if (overrides.secretWriteFails) {
                return Promise.reject(new Error("secret write failed for reviewer-raw-cap"));
            }
            return Promise.resolve();
        },
        deleteSecretRecord: (/** @type {string} */ path, /** @type {string} */ key) => {
            calls.deletedSecrets.push({ path, key });
            if (overrides.secretDeleteFails) {
                return Promise.reject(new Error("delete failed for maintainer-raw-cap"));
            }
            return Promise.resolve();
        },
        hashPlanBody: (/** @type {string} */ body) => Promise.resolve(`hash:${body.length}`),
        updatePlanCollaborationMetadata: (
            /** @type {string} */ _cwd,
            /** @type {string} */ planName,
            /** @type {any} */ updates,
            /** @type {symbol} */ bypass,
            /** @type {any} */ options,
        ) => {
            calls.metadata = { planName, updates, bypass, options };
            if (overrides.metadataFails) return Promise.reject(new Error("metadata write failed"));
            return Promise.resolve(updates);
        },
        ...overrides.deps,
    };
    return { deps, calls };
}

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<{ logs: string[], errors: string[] }>}
 */
async function captureLogs(fn) {
    /** @type {string[]} */
    const logs = [];
    /** @type {string[]} */
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (message = "") => logs.push(String(message));
    console.error = (message = "") => errors.push(String(message));
    try {
        await fn();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logs, errors };
}

Deno.test("parsePlansShareArgs accepts plan server forms and project secrets", () => {
    assertEquals(parsePlansShareArgs(["demo", "--plan-server", "https://plans.example", "--project-secrets"]), {
        planServer: "https://plans.example",
        projectSecrets: true,
        help: false,
        target: "demo",
    });
    assertEquals(
        parsePlansShareArgs(["--plan-server=https://plans.example", "demo"]).planServer,
        "https://plans.example",
    );
});

Deno.test("parsePlansShareArgs requires exactly one target", () => {
    assertThrows(() => parsePlansShareArgs([]), Error, "Missing Plan");
    assertThrows(() => parsePlansShareArgs(["one", "two"]), Error, "Unexpected share argument");
});

Deno.test("runPlansShareCommand resolves active Plan by name and sends encrypted create payload without raw secrets", async () => {
    const { deps, calls } = fakeShareDeps();
    const { logs } = await captureLogs(() =>
        runPlansShareCommand(["demo-plan", "--plan-server", "https://flag.example"], { __testDeps: deps })
    );

    assertEquals(calls.encryptedPayload, {
        planId: "plan-1",
        title: "Demo Plan",
        metadata: {
            planId: "plan-1",
            status: "approved",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Demo Plan",
            createdAt: "2026-07-04T00:00:00.000Z",
        },
        body: "# Demo\n\nBody text",
    });
    assertEquals(calls.createPayload, {
        planId: "plan-1",
        initialRevision: { payloadCiphertext: "ciphertext-only" },
        capabilities: [
            { scope: "reviewer", capabilityHash: "sha256:reviewer-hash" },
            { scope: "maintainer", capabilityHash: "sha256:maintainer-hash" },
        ],
    });
    assert(!JSON.stringify(calls.createPayload).includes("Body text"));
    assert(!JSON.stringify(calls.createPayload).includes("exported-crypto-key"));
    assert(!JSON.stringify(calls.createPayload).includes("reviewer-raw-cap"));
    assertEquals(calls.authHeaders, []);
    assert(logs.some((message) => message.includes("#key=exported-crypto-key&cap=reviewer-raw-cap&role=reviewer")));
    assert(logs.some((message) => message.includes("#key=exported-crypto-key&cap=maintainer-raw-cap&role=maintainer")));
    assert(logs.some((message) => message.includes("maintainer URL can pull, push, close, or unshare")));
});

Deno.test("runPlansShareCommand resolves active Plan by planId when name is missing", async () => {
    const { deps, calls } = fakeShareDeps();
    await captureLogs(() => runPlansShareCommand(["plan-1"], { __testDeps: deps }));
    assertEquals(calls.metadata.planName, "demo-plan");
});

Deno.test("runPlansShareCommand rejects already shared Plans before generating secrets", async () => {
    let generated = false;
    const { deps } = fakeShareDeps({
        resource: activeResource({ collaborationState: "remote_canonical" }),
        deps: {
            generateBearerCapability: () => {
                generated = true;
                return "cap";
            },
        },
    });
    await assertRejects(
        () => runPlansShareCommand(["demo-plan"], { __testDeps: deps }),
        Error,
        "already shared",
    );
    assertEquals(generated, false);
});

Deno.test("runPlansShareCommand uses configured server when flag is absent and stores global secrets", async () => {
    const { deps, calls } = fakeShareDeps();
    await captureLogs(() => runPlansShareCommand(["demo-plan"], { __testDeps: deps }));
    assertEquals(calls.secretPath, "/home/user/.wld/collaboration-secrets.json");
    assertEquals(calls.secretKey, "plan-1:space-1");
    assertEquals(calls.secretRecord.contentKey, "exported-crypto-key");
    assertEquals(calls.secretRecord.reviewerCapability, "reviewer-raw-cap");
    assertEquals(calls.secretRecord.maintainerCapability, "maintainer-raw-cap");
});

Deno.test("runPlansShareCommand supports project-local secrets and ignore opt-in", async () => {
    const { deps, calls } = fakeShareDeps();
    await captureLogs(() => runPlansShareCommand(["demo-plan", "--project-secrets"], { __testDeps: deps }));
    assertEquals(calls.secretPath, "/repo/.wld/collaboration-secrets.json");
    assertEquals(calls.ignoredProjectRoot, "/repo");
});

Deno.test("runPlansShareCommand writes only non-secret collaboration metadata to the Plan", async () => {
    const { deps, calls } = fakeShareDeps();
    await captureLogs(() =>
        runPlansShareCommand(["demo-plan", "--plan-server=https://plans.example/root"], { __testDeps: deps })
    );
    assertEquals(calls.metadata.updates, {
        collaborationState: "remote_canonical",
        collaborationServerUrl: "https://plans.example/root",
        collaborationSpaceId: "space-1",
        collaborationRevision: 1,
        collaborationBodyHash: "hash:17",
        collaborationSyncedAt: "2026-07-04T12:00:00.000Z",
    });
    assert(!JSON.stringify(calls.metadata.updates).includes("raw-cap"));
    assert(!JSON.stringify(calls.metadata.updates).includes("exported-crypto-key"));
});

Deno.test("runPlansShareCommand requires a Plan Server URL", async () => {
    const { deps } = fakeShareDeps({ deps: { getDefaultPlanServerUrl: () => undefined } });
    await assertRejects(
        () => runPlansShareCommand(["demo-plan"], { __testDeps: deps }),
        Error,
        "Missing Plan Server URL",
    );
});

Deno.test("runPlansShareCommand cleans up remote space after local persistence failure", async () => {
    const { deps, calls } = fakeShareDeps({ secretWriteFails: true });
    await assertRejects(
        () => captureLogs(() => runPlansShareCommand(["demo-plan"], { __testDeps: deps })),
        Error,
        "remote Shared Space space-1 was deleted",
    );
    assertEquals(calls.cleanupActions, ["delete"]);
    assertEquals(calls.deletedSecrets, [{ path: "/home/user/.wld/collaboration-secrets.json", key: "plan-1:space-1" }]);
});

Deno.test("runPlansShareCommand cleans up local secret record when metadata update fails after secret write", async () => {
    const { deps, calls } = fakeShareDeps({ metadataFails: true });
    await assertRejects(
        () => captureLogs(() => runPlansShareCommand(["demo-plan"], { __testDeps: deps })),
        Error,
        "local secret state was cleaned up",
    );
    assertEquals(calls.cleanupActions, ["delete"]);
    assertEquals(calls.deletedSecrets, [{ path: "/home/user/.wld/collaboration-secrets.json", key: "plan-1:space-1" }]);
});

Deno.test("runPlansShareCommand surfaces stale local secret state if rollback secret cleanup fails", async () => {
    const { deps, calls } = fakeShareDeps({ metadataFails: true, secretDeleteFails: true });
    const error = await assertRejects(
        () => captureLogs(() => runPlansShareCommand(["demo-plan"], { __testDeps: deps })),
        Error,
        "local secret cleanup failed",
    );
    assert(error.message.includes("plan-1:space-1"));
    assert(!error.message.includes("maintainer-raw-cap"));
    assertEquals(calls.cleanupActions, ["delete"]);
    assertEquals(calls.deletedSecrets, [{ path: "/home/user/.wld/collaboration-secrets.json", key: "plan-1:space-1" }]);
});

Deno.test("runPlansShareCommand prints recovery maintainer URL once if cleanup fails", async () => {
    const { deps } = fakeShareDeps({ secretWriteFails: true, cleanupFails: true });
    const result = await assertRejects(
        () => captureLogs(() => runPlansShareCommand(["demo-plan"], { __testDeps: deps })),
        Error,
        "Recovery URL was printed once",
    );
    assert(!result.message.includes("maintainer-raw-cap failed"));
});
