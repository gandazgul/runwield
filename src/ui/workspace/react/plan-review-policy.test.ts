// @ts-nocheck: Astro workspace check uses browser tsconfig without Deno/JSR test globals.
import { assertEquals } from "@std/assert";
import { readPlanReviewExecutionPolicy } from "./plan-review-policy.ts";

Deno.test("workflow-supplied Engineer Pair policy survives review", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: { executionAgent: "engineer", collaborationRecommendation: "pair", source: "canonical" },
    }, null);

    assertEquals(policy.executionAgent, "engineer");
    assertEquals(policy.collaborationRecommendation, "pair");
});

Deno.test("workflow-supplied Frontend Engineer Pair policy survives review", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: {
            executionAgent: "frontend-engineer",
            collaborationRecommendation: "pair",
            source: "canonical",
        },
    }, null);

    assertEquals(policy.executionAgent, "frontend-engineer");
    assertEquals(policy.collaborationRecommendation, "pair");
});

Deno.test("Engineer Pair written only in Plan Front Matter survives review", () => {
    const policy = readPlanReviewExecutionPolicy(null, {
        classification: "PLANNED_CHANGE",
        executionAgent: '"engineer"',
        collaborationRecommendation: '"pair"',
    });

    assertEquals(policy.executionAgent, "engineer");
    assertEquals(policy.collaborationRecommendation, "pair");
});

Deno.test("a Plan without a collaboration recommendation defaults to autonomous", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: { executionAgent: "frontend-engineer" },
    }, null);

    assertEquals(policy.executionAgent, "frontend-engineer");
    assertEquals(policy.collaborationRecommendation, "autonomous");
});

Deno.test("an unrecognized collaboration recommendation falls back to autonomous", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: { executionAgent: "engineer", collaborationRecommendation: "duet" },
    }, null);

    assertEquals(policy.collaborationRecommendation, "autonomous");
});

Deno.test("an unrecognized execution agent falls back to Engineer", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: { executionAgent: "architect", collaborationRecommendation: "pair" },
    }, null);

    assertEquals(policy.executionAgent, "engineer");
    assertEquals(policy.collaborationRecommendation, "pair");
});

Deno.test("a legacy frontend Plan resolves to autonomous Frontend Engineer", () => {
    const policy = readPlanReviewExecutionPolicy({
        frontmatter: { classification: "PLANNED_CHANGE", frontend: true },
    }, null);

    assertEquals(policy.executionAgent, "frontend-engineer");
    assertEquals(policy.collaborationRecommendation, "autonomous");
});

Deno.test("the workflow-resolved policy wins over Plan Front Matter", () => {
    const policy = readPlanReviewExecutionPolicy({
        executionPolicy: { executionAgent: "engineer", collaborationRecommendation: "pair" },
        frontmatter: { executionAgent: "frontend-engineer", collaborationRecommendation: "autonomous" },
    }, null);

    assertEquals(policy.executionAgent, "engineer");
    assertEquals(policy.collaborationRecommendation, "pair");
});

Deno.test("a FEATURE Plan reads as PLANNED_CHANGE and can still choose its execution policy", () => {
    const policy = readPlanReviewExecutionPolicy({ classification: "FEATURE" }, null);

    assertEquals(policy.classification, "PLANNED_CHANGE");
    assertEquals(policy.canSelectExecutionPolicy, true);
});

Deno.test("a PROJECT Epic cannot choose an execution policy", () => {
    const policy = readPlanReviewExecutionPolicy({ classification: "PROJECT" }, null);

    assertEquals(policy.classification, "PROJECT");
    assertEquals(policy.canSelectExecutionPolicy, false);
});
