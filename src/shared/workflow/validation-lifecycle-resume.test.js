import { assertEquals, assertThrows } from "@std/assert";
import { runValidationPhase } from "./validation.ts";
import { makeValidationProjectRoot } from "./validation-test-helpers.js";

/** @param {string} projectRoot */
function makeHostedSession(projectRoot) {
    return /** @type {import('../session/hosted-session.js').HostedSession} */ (/** @type {unknown} */ ({
        cwd: projectRoot,
        getActiveExecutionWorkflow: () => null,
        clearActiveExecutionWorkflow: () => {},
        setActiveExecutionWorkflow: () => {},
    }));
}

Deno.test("validated_ci resumes at semantic review without rerunning CI", async () => {
    const projectRoot = await makeValidationProjectRoot("demo", { status: "validated_ci" });
    try {
        let ciCalls = 0;
        const result = await runValidationPhase({
            planName: "demo",
            planContent: "---\nstatus: implemented\nclassification: FEATURE\n---\n# Demo\n",
            triageMeta: { classification: "FEATURE" },
            sessionManager: undefined,
            hostedSession: makeHostedSession(projectRoot),
            __deps: /** @type {any} */ ({
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        context: {
                            executionMode: "non_git_in_place",
                            projectRoot,
                            executionCwd: projectRoot,
                            source: "durable_recovery",
                            planName: "demo",
                        },
                    }),
                runLocalCI: () => {
                    ciCalls += 1;
                    return Promise.reject(new Error("CI must not run"));
                },
            }),
        });

        assertEquals(ciCalls, 0);
        assertEquals(result.kind, "paused");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("validated_reviewer with no human decision runs only the human review phase", async () => {
    const projectRoot = await makeValidationProjectRoot("demo", {
        status: "validated_reviewer",
        humanReviewDecision: null,
    });
    try {
        let ciCalls = 0;
        const result = await runValidationPhase({
            planName: "demo",
            planContent:
                "---\nstatus: validated_reviewer\nhumanReviewDecision: null\nclassification: FEATURE\n---\n# Demo\n",
            triageMeta: { status: "validated_reviewer", humanReviewDecision: null, classification: "FEATURE" },
            sessionManager: undefined,
            hostedSession: makeHostedSession(projectRoot),
            executionContext:
                /** @type {import('../session/hosted-session.js').ActiveExecutionWorkflow} */ ({ projectRoot }),
            __deps: {
                resolveValidationExecutionContext: () =>
                    Promise.resolve({
                        kind: "ok",
                        context: {
                            executionMode: "non_git_in_place",
                            projectRoot,
                            executionCwd: projectRoot,
                            source: "durable_recovery",
                            planName: "demo",
                        },
                    }),
                runLocalCI: () => {
                    ciCalls += 1;
                    return Promise.reject(new Error("CI must not run"));
                },
            },
        });

        assertEquals(result.kind, "paused");
        assertEquals(result.reason, "Local Human Code Review is not required.");
        assertEquals(ciCalls, 0);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("semantic_review_passed is illegal from implemented and verified", async () => {
    const { buildPlanEventUpdates } = await import("./plan-lifecycle.js");
    assertThrows(
        () => buildPlanEventUpdates("semantic_review_passed", "implemented"),
        Error,
        'semantic_review_passed cannot apply to status "implemented"',
    );
    assertThrows(
        () => buildPlanEventUpdates("semantic_review_passed", "verified"),
        Error,
        'semantic_review_passed cannot apply to status "verified"',
    );
});
