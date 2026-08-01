import { assertEquals } from "@std/assert";
import { collectConditionalSeams, collectSeamNames } from "./check-injection-seams.js";

/** @param {string[]} lines */
function conditionalLines(...lines) {
    return collectConditionalSeams(lines.join("\n")).map((offender) => offender.split(" ")[1]);
}

Deno.test("collectSeamNames reads member access and destructured bags", () => {
    const source = [
        "const a = __deps?.runLocalCI || runLocalCI;",
        "const b = __deps.recordPlanEvent;",
        "const { switchActiveAgent, runRootTurn: turn } = __testDeps;",
        "const { loadPlan } = options.__deps;",
    ].join("\n");

    assertEquals(collectSeamNames(source), [
        "loadPlan",
        "recordPlanEvent",
        "runLocalCI",
        "runRootTurn",
        "switchActiveAgent",
    ]);
});

// One line of indirection used to hide an entire bag, machinery included.
Deno.test("collectSeamNames follows a bag aliased to a local name", () => {
    const source = [
        "const deps = __deps || {};",
        "const value = deps.recordPlanEvent;",
        "await deps?.requestPlanReview();",
        "const other = notDeps.ignored;",
    ].join("\n");

    assertEquals(collectSeamNames(source), ["recordPlanEvent", "requestPlanReview"]);
});

Deno.test("collectConditionalSeams flags a seam gated on the bag itself", () => {
    assertEquals(
        conditionalLines(
            "const settle = __deps",
            "    ? (() => Promise.resolve(null))",
            "    : settleWorktreeAttempt;",
        ),
        ["2"],
    );
});

Deno.test("collectConditionalSeams flags a seam gated on a different dep", () => {
    assertEquals(
        conditionalLines("const head = __deps?.mergeExecutionWorktree ? fakeHead : getBranchHead;"),
        ["1"],
    );
});

// The shape that sat live in workflow.js under a green ratchet: the `__deps` reads are
// behind an `&&` and a paren, so nothing is adjacent to the `?`. Adjacency matching is
// why it was missed, so this is the case that must stay covered.
Deno.test("collectConditionalSeams flags a condition whose deps are not adjacent to the ?", () => {
    assertEquals(
        conditionalLines(
            "const settle = __deps?.settleWorktreeAttempt ||",
            "    ((__deps?.createWorktreeGitArtifacts && __deps?.updateWorktreeRegistryEntry)",
            "        ? ((_, worktree) => Promise.resolve(worktree))",
            "        : settleWorktreeAttempt);",
        ),
        ["3"],
    );
});

Deno.test("collectConditionalSeams flags a branch on an injected value compared to a literal", () => {
    assertEquals(
        conditionalLines('const run = __deps?.mode === "fake" ? fakeRun : runLocalCI;'),
        ["1"],
    );
});

Deno.test("collectConditionalSeams ignores unconditional seams and non-ternary question marks", () => {
    assertEquals(
        conditionalLines(
            "const a = __deps?.runLocalCI || runLocalCI;",
            "const b = __deps?.now ?? (() => Date.now());",
            "const c = __deps?.git?.isAncestor;",
            "const d = ready ? runLocalCI : skip;",
        ),
        [],
    );
});

// The bags are documented in JSDoc as `__deps?: { … }`, which is indistinguishable from a
// ternary to a text scan. A false positive here would make the rule unusable.
Deno.test("collectConditionalSeams ignores optional syntax in comments and type positions", () => {
    assertEquals(
        conditionalLines(
            "/**",
            " * @param {{ __deps?: { runLocalCI?: typeof runLocalCI } }} opts",
            " */",
            "export function run(opts, __deps?: Deps) {",
            "    return opts.value;",
            "}",
        ),
        [],
    );
});
