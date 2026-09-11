import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { injectFrontMatter, loadPlan, savePlan } from "../../plan-store.js";
import { git } from "../../shared/git-test-fixture.ts";
import { resolveProjectRuntimeLayout } from "../../shared/project-runtime-layout.ts";
import { createCollaborationClient, SYSTEM_COLLABORATION_FETCH } from "../../shared/collaboration/client.js";
import { encryptJsonPayload, importContentKey } from "../../shared/collaboration/crypto.js";
import {
    getGlobalSecretStorePath,
    getProjectSecretStorePath,
    readSecretStore,
} from "../../shared/collaboration/secrets.js";
import { parseCollaborationUrl } from "../../shared/collaboration/urls.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { withCollaborationServer } from "./collaboration-command-test-fixture.ts";
import { parsePlansPullArgs, pullPlanForRevision, runPlansPullCommand } from "./pull.ts";
import { parsePlansPushArgs, pushPlanRevision, runPlansPushCommand } from "./push.ts";
import { parsePlansShareArgs, runPlansShareCommand, sharePlanForReview } from "./share.ts";
import { parsePlansUnshareArgs, runPlansUnshareCommand, unsharePlan } from "./unshare.ts";

interface CapturedConsole {
    errors: string[];
    logs: string[];
}

async function captureConsole(run: () => Promise<void>): Promise<CapturedConsole> {
    const originalError = console.error;
    const originalLog = console.log;
    const errors: string[] = [];
    const logs: string[] = [];
    console.error = (message = "") => errors.push(String(message));
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.error = originalError;
        console.log = originalLog;
    }
    return { errors, logs };
}

async function seedPlan(projectRoot: string, name = "demo-plan"): Promise<void> {
    await savePlan(projectRoot, name, "# Demo Plan\n\nInitial fixture body.\n", {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        status: "approved",
        summary: "Demo collaboration Plan",
        affectedPaths: ["src/demo.ts"],
    });
}

function findRoleUrl(logs: string[], role: "maintainer" | "reviewer"): string {
    const url = logs.find((line) => line.startsWith("http") && line.includes(`role=${role}`));
    if (!url) throw new Error(`Missing ${role} collaboration URL in command output.`);
    return url;
}

async function createLinkedCheckout(projectRoot: string, linkedRoot: string): Promise<void> {
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "fixture@runwield.test"]);
    await git(projectRoot, ["config", "user.name", "RunWield Fixture"]);
    await git(projectRoot, ["config", "commit.gpgsign", "false"]);
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "collaboration fixture"]);
    await Deno.remove(linkedRoot, { recursive: true });
    await git(projectRoot, ["worktree", "add", "-b", `linked-${crypto.randomUUID()}`, linkedRoot]);
}

Deno.test("Plan collaboration argument parsers accept their public command forms", () => {
    assertEquals(parsePlansShareArgs(["demo", "--plan-server", "https://plans.example", "--project-secrets"]), {
        planServer: "https://plans.example",
        projectSecrets: true,
        help: false,
        target: "demo",
    });
    assertEquals(parsePlansPullArgs(["https://plans.example/p/space#key=k&cap=c&role=maintainer", "--to", "copy"]), {
        target: "https://plans.example/p/space#key=k&cap=c&role=maintainer",
        planServer: undefined,
        projectSecrets: false,
        to: "copy",
        help: false,
    });
    assertEquals(parsePlansPushArgs(["demo", "--project-secrets"]).projectSecrets, true);
    assertEquals(parsePlansUnshareArgs(["demo", "--force"]).force, true);
    assertThrows(() => parsePlansShareArgs([]), Error, "Missing Plan");
    assertThrows(() => parsePlansPullArgs(["one", "two"]), Error, "Unexpected pull argument");
    assertThrows(() => parsePlansPushArgs([]), Error, "Missing Plan");
    assertThrows(() => parsePlansUnshareArgs([]), Error, "Missing Plan");
});

Deno.test("share, push, pull, and unshare compose through real Plan, crypto, secret, runtime, and HTTP machinery", async () => {
    await withRuntimeCommandFixture(
        "runwield-plan-collaboration-",
        async ({ alternateRoot, projectRoot, setModelResponse }) => {
            await withCollaborationServer(async ({ adapter, serverUrl }) => {
                await seedPlan(projectRoot);
                setModelResponse("I reviewed the pulled fixture Plan and prepared the requested planning revision.");

                Deno.chdir(projectRoot);
                const sharedOutput = await captureConsole(() =>
                    runPlansShareCommand(["demo-plan", "--plan-server", serverUrl])
                );
                const reviewerUrl = findRoleUrl(sharedOutput.logs, "reviewer");
                const maintainerUrl = findRoleUrl(sharedOutput.logs, "maintainer");
                const reviewer = parseCollaborationUrl(reviewerUrl);
                const maintainer = parseCollaborationUrl(maintainerUrl);
                assertEquals(reviewer.spaceId, maintainer.spaceId);

                const sharedPlan = await loadPlan(projectRoot, "demo-plan");
                assert(sharedPlan);
                assertEquals(sharedPlan.attrs.collaborationState, "remote_canonical");
                assertEquals(sharedPlan.attrs.collaborationServerUrl, serverUrl);
                assertEquals(sharedPlan.attrs.collaborationRevision, 1);
                assertEquals(sharedPlan.body, "# Demo Plan\n\nInitial fixture body.\n");
                assertEquals(sharedPlan.markdown.includes(reviewer.contentKey), false);
                assertEquals(sharedPlan.markdown.includes(maintainer.bearerCapability), false);

                const globalSecrets = await readSecretStore(getGlobalSecretStorePath());
                const storedSecret = globalSecrets.records[`${sharedPlan.attrs.planId}:${reviewer.spaceId}`];
                assert(storedSecret);
                assertEquals(storedSecret.contentKey, reviewer.contentKey);
                assertEquals(storedSecret.reviewerCapability, reviewer.bearerCapability);
                assertEquals(storedSecret.maintainerCapability, maintainer.bearerCapability);

                const storedRemoteText = JSON.stringify(
                    adapter.database.handle.prepare(
                        "SELECT payload_ciphertext, capability_hash FROM space_revisions CROSS JOIN space_capabilities",
                    ).all(),
                );
                assertEquals(storedRemoteText.includes("Initial fixture body"), false);
                assertEquals(storedRemoteText.includes(reviewer.bearerCapability), false);
                assertEquals(storedRemoteText.includes(maintainer.bearerCapability), false);

                const pushedBody = "# Demo Plan\n\nBody edited in the fixture checkout before push.\n";
                await Deno.writeTextFile(sharedPlan.path, injectFrontMatter(pushedBody, sharedPlan.attrs));
                const pushedOutput = await captureConsole(() => runPlansPushCommand(["demo-plan"]));
                assertStringIncludes(pushedOutput.logs.join("\n"), "revision 2");
                assertStringIncludes(pushedOutput.logs.join("\n"), "role=reviewer");
                assertEquals(pushedOutput.logs.join("\n").includes(maintainer.bearerCapability), false);
                assertEquals((await loadPlan(projectRoot, "demo-plan"))?.attrs.collaborationRevision, 2);

                const reviewerClient = createCollaborationClient({
                    serverUrl,
                    bearerCapability: reviewer.bearerCapability,
                    fetch: SYSTEM_COLLABORATION_FETCH,
                });
                const commentKey = await importContentKey(reviewer.contentKey);
                const commentCiphertext = await encryptJsonPayload({
                    schemaVersion: 1,
                    type: "global_comment",
                    displayName: "Fixture Reviewer",
                    body: "Please preserve the fixture behavior.",
                    createdAt: "2026-08-03T12:00:00.000Z",
                }, commentKey);
                await reviewerClient.appendComment(reviewer.spaceId, 2, { ciphertext: commentCiphertext });

                Deno.chdir(alternateRoot);
                const runtime = createSessionRuntime();
                try {
                    const sessionId = await runtime.createPromptReadySession({
                        cwd: alternateRoot,
                        agentName: "router",
                    });
                    const pulledOutput = await captureConsole(() =>
                        runPlansPullCommand([maintainerUrl, "--to", "pulled-demo"], {
                            sessionRuntime: runtime,
                            sessionId,
                        })
                    );
                    assertStringIncludes(pulledOutput.logs.join("\n"), "revision 2");
                    assertStringIncludes(pulledOutput.logs.join("\n"), "Decrypted 1 comments (0 unreadable)");
                    assertStringIncludes(pulledOutput.logs.join("\n"), "Selected planning Agent");
                } finally {
                    runtime.closeAllSessions();
                }

                const pulledPlan = await loadPlan(alternateRoot, "pulled-demo");
                assert(pulledPlan);
                assertEquals(pulledPlan.body.trimEnd(), pushedBody.trimEnd());
                assertEquals(pulledPlan.attrs.planId, sharedPlan.attrs.planId);
                assertEquals(pulledPlan.attrs.collaborationRevision, 2);

                const unsharedOutput = await captureConsole(() => runPlansUnshareCommand(["pulled-demo", "--force"]));
                assertStringIncludes(unsharedOutput.logs.join("\n"), "Cleared local collaboration lock metadata");
                const unsharedPlan = await loadPlan(alternateRoot, "pulled-demo");
                assert(unsharedPlan);
                assertEquals(unsharedPlan.body.trimEnd(), pushedBody.trimEnd());
                assertEquals(unsharedPlan.attrs.collaborationState, undefined);
                assertEquals(Object.keys((await readSecretStore(getGlobalSecretStorePath())).records).length, 0);

                const deletedClient = createCollaborationClient({
                    serverUrl,
                    bearerCapability: maintainer.bearerCapability,
                    fetch: SYSTEM_COLLABORATION_FETCH,
                });
                await assertRejects(
                    () => deletedClient.getSharedSpace(maintainer.spaceId),
                    Error,
                    "Plan Server error 404",
                );
            });
        },
    );
});

Deno.test("project-local collaboration commands share one primary store across linked checkouts", async () => {
    await withRuntimeCommandFixture(
        "runwield-plan-collaboration-project-secrets-",
        async ({ alternateRoot, projectRoot }) => {
            const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
            try {
                await seedPlan(projectRoot, "project-secret-plan");
                await createLinkedCheckout(projectRoot, alternateRoot);
                const globalPath = getGlobalSecretStorePath();
                await Deno.mkdir(dirname(globalPath), { recursive: true });
                const globalBefore = `${
                    JSON.stringify(
                        {
                            schemaVersion: 1,
                            records: {
                                "global-plan:global-space": {
                                    planId: "global-plan",
                                    spaceId: "global-space",
                                    contentKey: "global-key",
                                    updatedAt: "2026-01-01T00:00:00.000Z",
                                },
                            },
                        },
                        null,
                        2,
                    )
                }\n`;
                await Deno.writeTextFile(globalPath, globalBefore);

                await withCollaborationServer(async ({ serverUrl }) => {
                    const shared = await sharePlanForReview({
                        target: "project-secret-plan",
                        cwd: alternateRoot,
                        planServer: serverUrl,
                        projectSecrets: true,
                    });
                    const maintainer = parseCollaborationUrl(shared.maintainerUrl);
                    const primaryStorePath = getProjectSecretStorePath(alternateRoot);
                    const projectStore = await readSecretStore(primaryStorePath);
                    const recordKey = `${shared.planId}:${shared.spaceId}`;
                    assertEquals(projectStore.records[recordKey].contentKey, maintainer.contentKey);
                    assertEquals(projectStore.records["global-plan:global-space"], undefined);
                    assertStringIncludes(await Deno.readTextFile(join(projectRoot, ".gitignore")), ".wld/internal");
                    await assertRejects(() => Deno.stat(join(alternateRoot, ".wld", "collaboration-secrets.json")));
                    await assertRejects(() => Deno.stat(join(projectRoot, ".wld", "collaboration-secrets.json")));
                    await assertRejects(() =>
                        Deno.stat(join(alternateRoot, ".wld", "internal", "collaboration-secrets.json"))
                    );
                    assertEquals(await Deno.readTextFile(globalPath), globalBefore);

                    const sharedPlan = await loadPlan(alternateRoot, "project-secret-plan");
                    assert(sharedPlan);
                    const primaryPlan = await loadPlan(projectRoot, "project-secret-plan");
                    assert(primaryPlan);
                    await Deno.writeTextFile(primaryPlan.path, sharedPlan.markdown);
                    const pushedBody = "# Demo Plan\n\nEdited in primary checkout.\n";
                    await Deno.writeTextFile(primaryPlan.path, injectFrontMatter(pushedBody, sharedPlan.attrs));
                    const pushed = await pushPlanRevision({
                        target: "project-secret-plan",
                        cwd: projectRoot,
                        projectSecrets: true,
                    });
                    assertEquals(pushed.revision, 2);

                    assertEquals(
                        (await loadPlan(projectRoot, "project-secret-plan"))?.body.trimEnd(),
                        pushedBody.trimEnd(),
                    );

                    await Deno.writeTextFile(
                        primaryStorePath,
                        `${
                            JSON.stringify(
                                {
                                    schemaVersion: 1,
                                    records: {
                                        ...projectStore.records,
                                        "other-plan:other-space": {
                                            ...projectStore.records[recordKey],
                                            planId: "other-plan",
                                            spaceId: "other-space",
                                        },
                                    },
                                },
                                null,
                                2,
                            )
                        }\n`,
                    );
                    const result = await unsharePlan({
                        target: "project-secret-plan",
                        cwd: projectRoot,
                        projectSecrets: true,
                        force: true,
                    });
                    assertEquals(result.deletedSecretCount, 1);
                    const afterUnshare = await readSecretStore(primaryStorePath);
                    assertEquals(afterUnshare.records[recordKey], undefined);
                    assertEquals(afterUnshare.records["other-plan:other-space"]?.planId, "other-plan");
                    assertEquals(await Deno.readTextFile(globalPath), globalBefore);
                });
            } finally {
                if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
                else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            }
        },
    );
});

Deno.test("project maintainer URL import writes only the fresh primary store and keeps the Plan selected-local", async () => {
    await withRuntimeCommandFixture("runwield-plan-collaboration-project-url-", async ({ projectRoot }) => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const freshPrimary = await Deno.makeTempDir({ prefix: "runwield-url-import-primary-" });
        const freshLinked = await Deno.makeTempDir({ prefix: "runwield-url-import-linked-" });
        try {
            await seedPlan(projectRoot, "source-url-plan");
            await withCollaborationServer(async ({ serverUrl }) => {
                const shared = await sharePlanForReview({
                    target: "source-url-plan",
                    cwd: projectRoot,
                    planServer: serverUrl,
                    projectSecrets: true,
                });
                await Deno.writeTextFile(join(freshPrimary, "README.md"), "# Fresh project\n");
                await createLinkedCheckout(freshPrimary, freshLinked);

                const pulled = await pullPlanForRevision({
                    target: shared.maintainerUrl,
                    cwd: freshLinked,
                    projectSecrets: true,
                    to: "imported-url-plan",
                });

                const importedPlan = await loadPlan(freshLinked, "imported-url-plan");
                assert(importedPlan);
                assertEquals(importedPlan.path?.startsWith(freshLinked), true);
                assertEquals(pulled.secretImported, true);
                const freshStorePath = getProjectSecretStorePath(freshLinked);
                const maintainer = parseCollaborationUrl(shared.maintainerUrl);
                assertEquals(
                    (await readSecretStore(freshStorePath)).records[`${shared.planId}:${shared.spaceId}`]
                        .maintainerCapability,
                    maintainer.bearerCapability,
                );
                assertEquals(Object.keys((await readSecretStore(getGlobalSecretStorePath())).records).length, 0);
                await assertRejects(() => Deno.stat(join(freshLinked, ".wld", "collaboration-secrets.json")));
                await assertRejects(() =>
                    Deno.stat(join(freshLinked, ".wld", "internal", "collaboration-secrets.json"))
                );
            });
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(freshLinked, { recursive: true }).catch(() => {});
            await Deno.remove(freshPrimary, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("project share does not write local secrets when primary ignore protection fails", async () => {
    await withRuntimeCommandFixture(
        "runwield-plan-collaboration-ignore-failure-",
        async ({ alternateRoot, projectRoot }) => {
            const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
            try {
                await seedPlan(projectRoot, "ignore-failure-plan");
                await createLinkedCheckout(projectRoot, alternateRoot);
                await Deno.remove(join(projectRoot, ".gitignore")).catch(() => {});
                await Deno.mkdir(join(projectRoot, ".gitignore"));
                await withCollaborationServer(async ({ serverUrl }) => {
                    await assertRejects(
                        () =>
                            sharePlanForReview({
                                target: "ignore-failure-plan",
                                cwd: alternateRoot,
                                planServer: serverUrl,
                                projectSecrets: true,
                            }),
                    );
                    await assertRejects(() =>
                        Deno.stat(resolveProjectRuntimeLayout(alternateRoot).primary.projectSecretStorePath)
                    );
                });
            } finally {
                if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
                else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            }
        },
    );
});

Deno.test("real collaboration guards reject unsafe operations without replacing their machinery", async () => {
    await withRuntimeCommandFixture("runwield-plan-collaboration-guards-", async ({ alternateRoot, projectRoot }) => {
        await withCollaborationServer(async ({ serverUrl }) => {
            await seedPlan(projectRoot, "guarded");
            const shared = await sharePlanForReview({ target: "guarded", cwd: projectRoot, planServer: serverUrl });

            await assertRejects(
                () => pushPlanRevision({ target: "guarded", cwd: projectRoot }),
                Error,
                "duplicate no-op revision",
            );
            await assertRejects(
                () => pullPlanForRevision({ target: shared.reviewerUrl, cwd: alternateRoot }),
                Error,
                "requires a maintainer URL",
            );
            await assertRejects(
                () =>
                    unsharePlan({
                        target: "guarded",
                        cwd: projectRoot,
                        planServer: "https://other.example",
                        force: true,
                    }),
                Error,
                "does not match",
            );

            await unsharePlan({ target: "guarded", cwd: projectRoot, force: true });
            await savePlan(projectRoot, "archived/old", "# Archived fixture", { status: "verified" });
            await assertRejects(
                () => sharePlanForReview({ target: "archived/old", cwd: projectRoot, planServer: serverUrl }),
                Error,
                "Cannot share archived Plans",
            );
        });
    });
});

Deno.test("push observes real remote revision and lifecycle conflicts", async () => {
    await withRuntimeCommandFixture("runwield-plan-collaboration-remote-guards-", async ({ projectRoot }) => {
        await withCollaborationServer(async ({ serverUrl }) => {
            await seedPlan(projectRoot, "stale-remote");
            await seedPlan(projectRoot, "closed-remote");
            const stale = await sharePlanForReview({ target: "stale-remote", cwd: projectRoot, planServer: serverUrl });
            const closed = await sharePlanForReview({
                target: "closed-remote",
                cwd: projectRoot,
                planServer: serverUrl,
            });
            const staleMaintainer = parseCollaborationUrl(stale.maintainerUrl);
            const closedMaintainer = parseCollaborationUrl(closed.maintainerUrl);
            const staleClient = createCollaborationClient({
                serverUrl,
                bearerCapability: staleMaintainer.bearerCapability,
                fetch: SYSTEM_COLLABORATION_FETCH,
            });
            const closedClient = createCollaborationClient({
                serverUrl,
                bearerCapability: closedMaintainer.bearerCapability,
                fetch: SYSTEM_COLLABORATION_FETCH,
            });
            await staleClient.appendRevision(stale.spaceId, {
                payloadCiphertext: "opaque-fixture-revision",
                expectedRevision: 2,
            });
            await closedClient.updateSharedSpaceLifecycle(closed.spaceId, { action: "close" });

            await assertRejects(
                () => pushPlanRevision({ target: "stale-remote", cwd: projectRoot }),
                Error,
                "Run `wld plans pull` before pushing",
            );
            await assertRejects(
                () => pushPlanRevision({ target: "closed-remote", cwd: projectRoot }),
                Error,
                "closed",
            );

            await unsharePlan({ target: "stale-remote", cwd: projectRoot, force: true });
            await unsharePlan({ target: "closed-remote", cwd: projectRoot, force: true });
        });
    });
});

Deno.test("declining the real unshare prompt preserves remote and local state", async () => {
    await withRuntimeCommandFixture("runwield-plan-collaboration-confirm-", async ({ projectRoot }) => {
        await withCollaborationServer(async ({ serverUrl }) => {
            await seedPlan(projectRoot, "keep-shared");
            const shared = await sharePlanForReview({ target: "keep-shared", cwd: projectRoot, planServer: serverUrl });
            const maintainer = parseCollaborationUrl(shared.maintainerUrl);
            const client = createCollaborationClient({
                serverUrl,
                bearerCapability: maintainer.bearerCapability,
                fetch: SYSTEM_COLLABORATION_FETCH,
            });
            const previousPrompt = globalThis.prompt;
            globalThis.prompt = () => "no";
            try {
                await assertRejects(
                    () => unsharePlan({ target: "keep-shared", cwd: projectRoot }),
                    Error,
                    "Unshare cancelled",
                );
            } finally {
                globalThis.prompt = previousPrompt;
            }

            await client.getSharedSpace(shared.spaceId);
            assertEquals((await loadPlan(projectRoot, "keep-shared"))?.attrs.collaborationState, "remote_canonical");
            assert(Object.keys((await readSecretStore(getGlobalSecretStorePath())).records).length > 0);
            await unsharePlan({ target: "keep-shared", cwd: projectRoot, force: true });
        });
    });
});

Deno.test("unshare recovers real local state when the remote Space is already deleted", async () => {
    await withRuntimeCommandFixture("runwield-plan-collaboration-deleted-", async ({ projectRoot }) => {
        await withCollaborationServer(async ({ serverUrl }) => {
            await seedPlan(projectRoot, "deleted-remote");
            const shared = await sharePlanForReview({
                target: "deleted-remote",
                cwd: projectRoot,
                planServer: serverUrl,
            });
            const maintainer = parseCollaborationUrl(shared.maintainerUrl);
            const client = createCollaborationClient({
                serverUrl,
                bearerCapability: maintainer.bearerCapability,
                fetch: SYSTEM_COLLABORATION_FETCH,
            });
            await client.deleteSharedSpace(shared.spaceId);

            const result = await unsharePlan({ target: "deleted-remote", cwd: projectRoot, force: true });
            assertEquals(result.alreadyDeleted, true);
            assertEquals(result.localMetadataCleared, true);
            assertEquals((await loadPlan(projectRoot, "deleted-remote"))?.attrs.collaborationState, undefined);
            assertEquals(Object.keys((await readSecretStore(getGlobalSecretStorePath())).records).length, 0);
        });
    });
});
