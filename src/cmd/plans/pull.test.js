import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parsePlansPullArgs, pullPlanForRevision, runPlansPullCommand } from "./pull.js";

const MAINTAINER_URL =
    "https://plans.example/p/space-1#key=content-key-secret&cap=maintainer-cap-secret&role=maintainer";

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

function remoteRevision(overrides = {}) {
    return {
        spaceId: "space-1",
        revision: 2,
        createdAt: "2026-07-04T00:00:00.000Z",
        payloadCiphertext: "plan-cipher",
        ...overrides,
    };
}

function planPayload(overrides = {}) {
    return {
        planId: "plan-1",
        title: "Demo Pull Plan",
        metadata: {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Demo pull",
            status: "draft",
            affectedPaths: [],
        },
        body: "# Demo\n\nRemote body",
        ...overrides,
    };
}

/** @param {Record<string, any>} [overrides] */
function fakePullDeps(overrides = {}) {
    const calls = {
        secretWrites: /** @type {Array<{ path: string, key: string, record: any }>} */ ([]),
        created: /** @type {any} */ (undefined),
        metadata: /** @type {any} */ (undefined),
        planning: /** @type {any} */ (undefined),
        secretCompatibility: /** @type {any} */ (undefined),
        ignoredProjectRoot: "",
    };
    const resources = overrides.resources || [];
    const deps = {
        cwd: "/repo",
        now: "2026-07-04T12:00:00.000Z",
        importContentKey: (/** @type {string} */ key) => Promise.resolve(`imported:${key}`),
        decryptJsonPayload: (/** @type {string} */ ciphertext) => {
            if (ciphertext === "plan-cipher") return Promise.resolve(overrides.planPayload || planPayload());
            if (ciphertext === "comment-cipher") {
                return Promise.resolve({
                    schemaVersion: 1,
                    type: "comment",
                    displayName: "Alice",
                    body: "Please clarify this section.",
                    originalText: "Remote body",
                    anchor: { blockId: "b1", startOffset: 1, endOffset: 4 },
                    createdAt: "comment-created",
                });
            }
            return Promise.reject(new Error("tampered ciphertext content-key-secret maintainer-cap-secret"));
        },
        createCollaborationClient: () => ({
            getSharedSpace: () =>
                overrides.spaceError
                    ? Promise.reject(overrides.spaceError)
                    : Promise.resolve(remoteSpace(overrides.space)),
            getRevision: () => Promise.resolve(remoteRevision(overrides.revision)),
            listComments: () =>
                Promise.resolve(
                    overrides.commentsResponse || {
                        comments: overrides.comments || [{
                            id: "comment-1",
                            spaceId: "space-1",
                            ciphertext: "comment-cipher",
                            createdAt: "remote-created",
                            resolved: false,
                        }],
                    },
                ),
        }),
        listPlanResources: () => Promise.resolve(resources),
        hashPlanBody: (/** @type {string} */ body) => Promise.resolve(`hash:${body}`),
        getGlobalSecretStorePath: () => "/global/secrets.json",
        getProjectSecretStorePath: () => "/repo/.wld/collaboration-secrets.json",
        resolvePullSecretRecord: () => Promise.resolve(overrides.secretRecord || null),
        assertCompatiblePullSecretRecord: (
            /** @type {string[]} */ paths,
            /** @type {string} */ planId,
            /** @type {string} */ spaceId,
            /** @type {any} */ record,
        ) => {
            calls.secretCompatibility = { paths, planId, spaceId, record };
            return overrides.secretCompatibilityError
                ? Promise.reject(overrides.secretCompatibilityError)
                : Promise.resolve();
        },
        putCompatibleSecretRecord: (
            /** @type {string} */ path,
            /** @type {string} */ key,
            /** @type {any} */ record,
        ) => {
            calls.secretWrites.push({ path, key, record });
            return Promise.resolve();
        },
        ensureProjectSecretStoreIgnored: (/** @type {string} */ cwd) => {
            calls.ignoredProjectRoot = cwd;
            return Promise.resolve();
        },
        createPulledCollaborationPlan: (/** @type {string} */ _cwd, /** @type {any} */ options) => {
            calls.created = options;
            return Promise.resolve({
                planName: options.preferredName || "demo-pull-plan",
                path: `/repo/plans/${options.preferredName || "demo-pull-plan"}.md`,
                attrs: options.attrs,
                body: options.body,
                markdown: "",
            });
        },
        updatePlanCollaborationMetadata: (
            /** @type {string} */ _cwd,
            /** @type {string} */ planName,
            /** @type {any} */ updates,
            /** @type {symbol} */ bypass,
            /** @type {any} */ options,
        ) => {
            calls.metadata = { planName, updates, bypass, options };
            return Promise.resolve(updates);
        },
        runPlanningAgent: (/** @type {any} */ request) => {
            calls.planning = request;
            return Promise.resolve({ outcome: "saved" });
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

Deno.test("parsePlansPullArgs accepts plan server, project secrets, and destination", () => {
    assertEquals(
        parsePlansPullArgs([
            MAINTAINER_URL,
            "--plan-server",
            "https://override.example",
            "--project-secrets",
            "--to",
            "copy/demo",
        ]),
        {
            target: MAINTAINER_URL,
            planServer: "https://override.example",
            projectSecrets: true,
            to: "copy/demo",
            help: false,
        },
    );
});

Deno.test("parsePlansPullArgs requires exactly one target", () => {
    assertThrows(() => parsePlansPullArgs([]), Error, "Missing maintainer URL");
    assertThrows(() => parsePlansPullArgs(["one", "two"]), Error, "Unexpected pull argument");
});

Deno.test("pullPlanForRevision imports a maintainer URL and auto-creates a locked local Plan", async () => {
    const { deps, calls } = fakePullDeps();
    const result = await pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps);

    assertEquals(result.action, "created");
    assertEquals(result.planName, "demo-pull-plan");
    assertEquals(calls.created.title, "Demo Pull Plan");
    assertEquals(calls.created.attrs.collaborationState, "remote_canonical");
    assertEquals(calls.created.attrs.collaborationRevision, 2);
    assertEquals(calls.created.attrs.collaborationBodyHash, "hash:# Demo\n\nRemote body");
    assertEquals(calls.secretWrites[0].key, "plan-1:space-1");
    assertEquals(calls.secretWrites[0].record.maintainerCapability, "maintainer-cap-secret");
    assertEquals(result.comments[0].body, "Please clarify this section.");
});

Deno.test("pullPlanForRevision checks all secret stores before importing URL secrets", async () => {
    const { deps, calls } = fakePullDeps();
    await pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps);

    assertEquals(calls.secretCompatibility.paths, ["/global/secrets.json", "/repo/.wld/collaboration-secrets.json"]);
    assertEquals(calls.secretCompatibility.planId, "plan-1");
    assertEquals(calls.secretCompatibility.spaceId, "space-1");
    assertEquals(calls.secretCompatibility.record.maintainerCapability, "maintainer-cap-secret");
});

Deno.test("pullPlanForRevision stops URL imports on cross-store secret conflicts", async () => {
    const { deps, calls } = fakePullDeps({
        secretCompatibilityError: new Error("Conflicting collaboration secret record"),
    });

    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps),
        Error,
        "Conflicting collaboration secret record",
    );
    assertEquals(calls.secretWrites.length, 0);
});

Deno.test("pullPlanForRevision honors --to and project secret storage for fresh URL pulls", async () => {
    const { deps, calls } = fakePullDeps();
    const result = await pullPlanForRevision({
        target: MAINTAINER_URL,
        cwd: "/repo",
        to: "copied/review",
        projectSecrets: true,
    }, deps);

    assertEquals(result.planName, "copied/review");
    assertEquals(calls.created.preferredName, "copied/review");
    assertEquals(calls.secretWrites[0].path, "/repo/.wld/collaboration-secrets.json");
    assertEquals(calls.ignoredProjectRoot, "/repo");
});

Deno.test("pullPlanForRevision rejects malformed remote comments responses", async () => {
    const { deps } = fakePullDeps({ commentsResponse: { items: [] } });

    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps),
        Error,
        "Remote comments response must be an array or an object with a comments array",
    );
});

Deno.test("pullPlanForRevision rejects --to when URL pull matches an existing local Plan", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps } = fakePullDeps({ resources: [existing] });

    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo", to: "copied/review" }, deps),
        Error,
        "--to is only supported for fresh maintainer URL pulls",
    );
});

Deno.test("pullPlanForRevision updates an existing shared Plan using stored maintainer secrets", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps, calls } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
    });
    const result = await pullPlanForRevision({ target: "demo", cwd: "/repo" }, deps);

    assertEquals(result.action, "updated");
    assertEquals(calls.metadata.planName, "demo");
    assertEquals(calls.metadata.options.body, "# Demo\n\nRemote body");
    assertEquals(calls.secretWrites.length, 0);
});

Deno.test("pullPlanForRevision refuses to rewrite a local Plan to a different remote planId", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-other",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-other",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
    });

    await assertRejects(
        () => pullPlanForRevision({ target: "demo", cwd: "/repo" }, deps),
        Error,
        "Local Plan planId does not match the remote Plan payload",
    );
});

Deno.test("pullPlanForRevision resolves an existing shared Plan by planId", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps, calls } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
    });
    const result = await pullPlanForRevision({ target: "plan-1", cwd: "/repo" }, deps);

    assertEquals(result.action, "updated");
    assertEquals(calls.metadata.planName, "demo");
});

Deno.test("pullPlanForRevision refuses URL pull overwrite of unshared matching planId", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nUnshared local draft",
        attrs: { planId: "plan-1", classification: "FEATURE" },
    };
    const { deps } = fakePullDeps({ resources: [existing] });

    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps),
        Error,
        "not a complete remote-canonical collaboration Plan",
    );
});

Deno.test("pullPlanForRevision refuses remote server rebinding for matching planId", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://other-plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
    });

    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps),
        Error,
        "different remote Shared Space",
    );
});

Deno.test("pullPlanForRevision blocks local divergence before overwriting", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nEdited locally",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
    });

    await assertRejects(
        () => pullPlanForRevision({ target: "demo", cwd: "/repo" }, deps),
        Error,
        "Local Plan body diverged",
    );
});

Deno.test("pullPlanForRevision rejects reviewer URLs and redacts fetch errors", async () => {
    const reviewerUrl = "https://plans.example/p/space-1#key=content-key-secret&cap=reviewer-cap-secret&role=reviewer";
    const { deps } = fakePullDeps({ spaceError: new Error("Authorization: Bearer maintainer-cap-secret failed") });
    await assertRejects(
        () => pullPlanForRevision({ target: reviewerUrl, cwd: "/repo" }, deps),
        Error,
        "requires a maintainer URL",
    );
    await assertRejects(
        () => pullPlanForRevision({ target: MAINTAINER_URL, cwd: "/repo" }, deps),
        Error,
        "Authorization: Bearer [redacted]",
    );
});

Deno.test("runPlansPullCommand selects Agent from decrypted remote metadata for existing Plans", async () => {
    const existing = {
        name: "demo",
        planName: "demo",
        path: "/repo/plans/demo.md",
        planId: "plan-1",
        body: "# Demo\n\nOld remote body",
        attrs: {
            planId: "plan-1",
            classification: "FEATURE",
            collaborationState: "remote_canonical",
            collaborationServerUrl: "https://plans.example",
            collaborationSpaceId: "space-1",
            collaborationRevision: 1,
            collaborationBodyHash: "hash:# Demo\n\nOld remote body",
        },
    };
    const { deps, calls } = fakePullDeps({
        resources: [existing],
        secretRecord: { record: { contentKey: "content-key", maintainerCapability: "maintainer-cap" } },
        planPayload: planPayload({
            metadata: {
                classification: "PROJECT",
                complexity: "MEDIUM",
                summary: "Remote project summary",
                status: "draft",
                affectedPaths: ["src/project.js"],
            },
        }),
    });
    const logs = await captureLogs(() => runPlansPullCommand(["demo"], { __testDeps: deps }));

    assertEquals(calls.planning.agentName, "architect");
    assert(calls.planning.initialRequest.includes("Classification: PROJECT"));
    assert(calls.planning.initialRequest.includes("Remote project summary"));
    assert(logs.some((line) => line.includes("Selected planning Agent: architect")));
});

Deno.test("runPlansPullCommand launches planning Agent with redacted decrypted review context and no execution dispatch", async () => {
    const { deps, calls } = fakePullDeps();
    const logs = await captureLogs(() => runPlansPullCommand([MAINTAINER_URL], { __testDeps: deps }));

    assertEquals(calls.planning.agentName, "planner");
    assert(calls.planning.initialRequest.includes("Please clarify this section."));
    assert(calls.planning.initialRequest.includes("Selected text: Remote body"));
    assert(!calls.planning.initialRequest.includes("content-key-secret"));
    assert(!calls.planning.initialRequest.includes("maintainer-cap-secret"));
    assert(logs.some((line) => line.includes("Selected planning Agent: planner")));
    assert(logs.some((line) => line.includes("wld plans push demo-pull-plan")));
});
