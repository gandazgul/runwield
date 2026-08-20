/**
 * The three coding Agents each hold one work contract, and the split only holds
 * if none of them carries the other's language. Engineer must not be told to
 * follow a Plan it will never receive; the Plan executors must not be told they
 * can take a QUICK_FIX they will never be routed.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { isWorkflowOnlyAgent, listAllAgentDefinitions, listAvailableAgents, loadAgentDef } from "./agents.js";

const QUICK_FIX_AGENT = "engineer";
const PLAN_EXECUTION_AGENTS: readonly string[] = ["plan-engineer", "frontend-engineer"];

/** Exactly what each contract claims. An added or dropped fragment is a contract change. */
const DECLARED_SHARED_PRACTICE: ReadonlyArray<[string, readonly string[]]> = [
    ["engineer", ["user-authority", "working-tree-safety", "engineering-practice", "bounded-request"]],
    ["plan-engineer", ["user-authority", "working-tree-safety", "engineering-practice", "plan-execution"]],
    ["frontend-engineer", ["user-authority", "working-tree-safety", "engineering-practice", "plan-execution"]],
];

/** Phrases that only make sense to an Agent that executes an approved Plan. */
const PLAN_EXECUTION_LANGUAGE: readonly string[] = [
    "approved Planned Change Plan",
    "Validation Continuation",
    "Runtime Collaboration Style",
    "pair_checkpoint",
    "Implementation Steps",
];

/** Phrases that only make sense to an Agent that takes no-Plan bounded work. */
const QUICK_FIX_LANGUAGE: readonly string[] = [
    "QUICK_FIX",
    "Quick Fix Checklist",
    "Mechanical Validation",
];

/**
 * Read the `sharedPractice:` list straight from the bundled definition file.
 * The merged prompt cannot answer this: two fragments can produce overlapping
 * text, so only the declaration says which contract an Agent claims.
 */
async function readDeclaredSharedPractice(agentName: string): Promise<string[]> {
    const contents = await Deno.readTextFile(join("src", "agent-definitions", `${agentName}.md`));
    const list = contents.match(/^sharedPractice:\n((?:[ \t]+-[^\n]*\n)+)/m);
    if (!list) return [];
    return list[1].split("\n").map((line) => line.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean);
}

Deno.test("each coding Agent claims exactly the shared practice its contract needs", async () => {
    for (const [agentName, expected] of DECLARED_SHARED_PRACTICE) {
        assertEquals(
            await readDeclaredSharedPractice(agentName),
            [...expected],
            `${agentName} shared practice drifted`,
        );
    }
});

Deno.test("Engineer is never told to execute a Plan", async () => {
    const { systemPrompt } = await loadAgentDef(QUICK_FIX_AGENT);
    for (const phrase of PLAN_EXECUTION_LANGUAGE) {
        assertEquals(
            systemPrompt.includes(phrase),
            false,
            `Engineer's Quick Fix prompt carries Plan execution language: ${phrase}`,
        );
    }
});

Deno.test("the Plan executors are never told they can take a QUICK_FIX", async () => {
    for (const agentName of PLAN_EXECUTION_AGENTS) {
        const { systemPrompt } = await loadAgentDef(agentName);
        for (const phrase of QUICK_FIX_LANGUAGE) {
            assertEquals(
                systemPrompt.includes(phrase),
                false,
                `${agentName}'s Plan prompt carries QUICK_FIX language: ${phrase}`,
            );
        }
    }
});

Deno.test("Engineer states its own Quick Fix contract", async () => {
    const { systemPrompt } = await loadAgentDef(QUICK_FIX_AGENT);
    assertStringIncludes(systemPrompt, "Quick Fix Checklist");
    assertStringIncludes(systemPrompt, "One Task at a Time, With Elastic Edges");
});

Deno.test("Engineer is told to load domain Skills rather than refuse unfamiliar work", async () => {
    // The split removed Frontend Engineer from QUICK_FIX, so a UI quick fix now
    // lands here. Engineer has to reach for the browser Skills, not decline.
    const { systemPrompt } = await loadAgentDef(QUICK_FIX_AGENT);
    const normalized = systemPrompt.replaceAll(/\s+/g, " ");
    assertStringIncludes(normalized, "Load the Skill that covers the domain");
    assertStringIncludes(normalized, "Browser UI means the frontend and browser Skills");
    // Skills do not cover every library, so Engineer is also pointed at the web
    // tools it actually holds for documentation it cannot find locally.
    assertStringIncludes(normalized, "`web_docs_search`");
});

Deno.test("Plan Engineer owns non-browser Plan execution and says so", async () => {
    const { systemPrompt } = await loadAgentDef("plan-engineer");
    assertStringIncludes(systemPrompt, "approved Planned Change Plan");
    assertStringIncludes(systemPrompt, "A Validation Continuation");
    assertStringIncludes(systemPrompt, "Runtime Collaboration Style");
});

Deno.test("Frontend Engineer keeps its browser preflight and evidence rules", async () => {
    // Losing QUICK_FIX must not cost it the rigor that made it worth keeping.
    const { systemPrompt } = await loadAgentDef("frontend-engineer");
    assertStringIncludes(systemPrompt, "headed browser");
    assertStringIncludes(systemPrompt, "browserPreflightOutcome");
});

Deno.test("both Plan executors are workflow-only and Engineer is selectable", async () => {
    for (const agentName of PLAN_EXECUTION_AGENTS) {
        const def = await loadAgentDef(agentName);
        assertEquals(def.workflowOnly, true, `${agentName} must be workflow-only`);
        assertEquals(await isWorkflowOnlyAgent(agentName), true);
    }
    const engineer = await loadAgentDef(QUICK_FIX_AGENT);
    assertEquals(engineer.workflowOnly, false);
    assertEquals(await isWorkflowOnlyAgent(QUICK_FIX_AGENT), false);
});

Deno.test("the selectable listing offers Engineer alone of the three coding Agents", async () => {
    const selectable = (await listAvailableAgents()).map((agent) => agent.name);
    assertEquals(selectable.includes(QUICK_FIX_AGENT), true);
    for (const agentName of PLAN_EXECUTION_AGENTS) {
        assertEquals(selectable.includes(agentName), false, `${agentName} must not be manually selectable`);
    }
});

Deno.test("workflow-only Agents still exist as ordinary definitions the runtime can load", async () => {
    // Hidden from the user's choices, not from RunWield: Plan dispatch loads
    // these by name, so filtering discovery must not remove the definition.
    const everyAgent = (await listAllAgentDefinitions()).map((agent) => agent.name);
    for (const agentName of PLAN_EXECUTION_AGENTS) {
        assertEquals(everyAgent.includes(agentName), true, `${agentName} must remain loadable`);
    }
});

Deno.test("a project layer can hide or unhide an Agent through merged front matter", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-agent-contracts-" });
    try {
        const agentsDir = join(projectRoot, ".wld", "agents");
        await Deno.mkdir(agentsDir, { recursive: true });
        await Deno.writeTextFile(join(agentsDir, "engineer.md"), "---\nworkflowOnly: true\n---\n\nOverride body.\n");
        await Deno.writeTextFile(join(agentsDir, "plan-engineer.md"), "---\nworkflowOnly: false\n---\n\nOverride.\n");

        const selectable = (await listAvailableAgents(projectRoot)).map((agent) => agent.name);
        assertEquals(selectable.includes("engineer"), false);
        assertEquals(selectable.includes("plan-engineer"), true);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
