import { assertEquals, assertStringIncludes } from "@std/assert";

import { SUBAGENTS } from "../../constants.js";
import { loadSubAgentDefinition } from "../session/subagent-definitions.ts";
import { loadManualQaPrompt, loadReviewerPrompt } from "./validation.ts";

Deno.test("loadManualQaPrompt returns a bare tool-free prompt", async () => {
    const promptDef = await loadManualQaPrompt();
    assertEquals(promptDef.name, "operator");
    assertEquals(promptDef.displayName, "Manual QA");
    assertEquals(promptDef.tools, ["qa_checklist_generated"]);
    assertStringIncludes(promptDef.systemPrompt, "Manual verification steps for <plan name>");
});

Deno.test("bundled Manual QA prompt requires the user checklist shape", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/subagent-definitions/manual-qa-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Manual verification steps for <plan name>");
    assertStringIncludes(prompt, "- [ ] step 1");
    assertStringIncludes(prompt, "automated verification has already passed");
});

Deno.test("loadReviewerPrompt returns a bare prompt with canonical review tools", async () => {
    const reviewerDef = await loadReviewerPrompt("discovery");
    assertEquals(reviewerDef.name, "reviewer");
    assertEquals(reviewerDef.displayName, "Reviewer");
    assertEquals(reviewerDef.tools, ["read", "grep", "find", "ls", "review_diff", "review_complete"]);
    assertStringIncludes(reviewerDef.systemPrompt, "Your Default Is Approval");
    assertEquals(reviewerDef.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewerDef.systemPrompt.includes("Available tools"), false);
});

Deno.test("loadReviewerPrompt loads the verification prompt for later rounds", async () => {
    const reviewerDef = await loadReviewerPrompt("verify");
    assertStringIncludes(reviewerDef.systemPrompt, "Do Not Re-Derive the Plan");
});

/** @param {string} name */
function readBundledPrompt(name) {
    return Deno.readTextFile(new URL(`../../agent-definitions/subagent-definitions/${name}`, import.meta.url));
}

Deno.test("bundled discovery reviewer prompt states an approval default", async () => {
    const prompt = await readBundledPrompt("reviewer-prompt.md");

    // Without an explicit default, the prompt's exhaustiveness pressure resolves
    // toward rejection: producing a finding is a concrete action, judging
    // "good enough" is not.
    assertStringIncludes(prompt, "Your Default Is Approval");
    assertStringIncludes(
        prompt,
        "Approve unless you can name **both** the specific Plan requirement and the specific changed code",
    );
    assertStringIncludes(prompt.replace(/\s+/g, " "), "are not reasons to reject");
    assertStringIncludes(prompt, "This does not lower the bar for plan adherence");
});

Deno.test("bundled discovery reviewer prompt keeps code smells non-blocking", async () => {
    const prompt = await readBundledPrompt("reviewer-prompt.md");

    // Smells scale with diff size, which grows with every repair — leaving them
    // blocking is what let the review loop ratchet forever.
    assertStringIncludes(prompt, "**Review Advisories never block.**");
    assertStringIncludes(prompt, "speculative generality, duplicated logic, repeated conditionals");
    assertStringIncludes(prompt, "Report advisories alongside an approving decision");
    assertStringIncludes(
        prompt.replace(/\s+/g, " "),
        "Never convert an advisory into a rejection because several of them accumulated",
    );
});

Deno.test("bundled discovery reviewer blocks new seams over product-owned machinery", async () => {
    const prompt = (await readBundledPrompt("reviewer-prompt.md")).replace(/\s+/g, " ");

    assertStringIncludes(prompt, "A new injection seam that lets tests or callers replace product-owned machinery");
    assertStringIncludes(prompt, "Required ports are legitimate only for genuine external capabilities");
    assertStringIncludes(prompt, "renaming an override bag or making an internal collaborator required");
    assertStringIncludes(prompt, "Scan production changes for new injection seams");
});

Deno.test("bundled discovery reviewer prompt requires reading the diff before deciding", async () => {
    const prompt = await readBundledPrompt("reviewer-prompt.md");

    // The diff is never inlined, so a verdict without a review_diff call is a
    // decision made without reading the code.
    assertStringIncludes(prompt, 'Call `review_diff(command: "list")` first');
    assertStringIncludes(prompt, "You cannot review what you have not read");
});

Deno.test("bundled reviewer prompts exclude verification-completion auditing", async () => {
    for (const name of ["reviewer-prompt.md", "reviewer-verify-prompt.md"]) {
        // Collapse wrapping so these assert on wording, not on where the
        // formatter happened to break the line.
        const prompt = (await readBundledPrompt(name)).replace(/\s+/g, " ");

        assertStringIncludes(prompt, "your only concern, approve.", `${name} must approve on evidence-only concerns`);
        assertStringIncludes(prompt, "workflow context, not requirements", name);
        assertStringIncludes(prompt, "Formatter-only churn", name);
        assertStringIncludes(prompt, "a command", name);
        assertStringIncludes(prompt, "report to be filed so that you can approve", name);
    }
});

Deno.test("bundled discovery reviewer prompt requires all findings in one pass", async () => {
    const prompt = (await readBundledPrompt("reviewer-prompt.md")).replace(/\s+/g, " ");

    // Later rounds are narrower and will not rediscover what a discovery round
    // misses, so holding findings back loses them.
    assertStringIncludes(prompt, "Finding one issue does not finish the round");
    assertStringIncludes(prompt, "do not hold findings back for a later round");
    assertStringIncludes(prompt, "Report the complete set now, not one representative issue");
});

Deno.test("bundled verification reviewer prompt refuses to re-derive the Plan", async () => {
    const prompt = (await readBundledPrompt("reviewer-verify-prompt.md")).replace(/\s+/g, " ");

    assertStringIncludes(prompt, "Do Not Re-Derive the Plan");
    assertStringIncludes(prompt, "open code-smell findings at all");
    assertStringIncludes(prompt, "Is each open ledger item actually fixed?");
    assertStringIncludes(prompt, "Did the repair introduce a new Plan divergence or regression?");
    assertStringIncludes(prompt, "A new injection seam in a touched production hunk");
    assertStringIncludes(prompt, "only required ports for genuine external capabilities are legitimate");
});

Deno.test("bundled verification reviewer prompt treats repair claims as evidence, not resolution", async () => {
    const prompt = await readBundledPrompt("reviewer-verify-prompt.md");

    assertStringIncludes(prompt, "never proof");
    assertStringIncludes(prompt, "An item is resolved when you have seen the fix, not when it was claimed");
    assertStringIncludes(prompt, "Omitting an item does not resolve it");
    assertStringIncludes(prompt, "Never renumber, reuse, or invent identities");
    // An empty repair means the fix was not implemented, not that there is
    // nothing to object to.
    assertStringIncludes(prompt.replace(/\s+/g, " "), "Reject; do not approve for lack of evidence");
});

Deno.test("bundled validation repair engineer prompt is repair-scoped without Plan or general Engineer context", async () => {
    const prompt = await readBundledPrompt("reviewer-feedback-engineer.md");
    const compact = prompt.replace(/\s+/g, " ");

    assertStringIncludes(prompt, "repair the validation problem you were given and report what you did");
    assertStringIncludes(compact, "the general Engineer prompt");
    assertStringIncludes(prompt, "one bounded repair packet");
    assertStringIncludes(prompt, "CI diagnostics");
    assertStringIncludes(compact, "semantic review findings");
    assertEquals(prompt.includes("Plan"), false);
    assertStringIncludes(prompt, "**Your claims are evidence, not resolution.**");
});

Deno.test("validation repair engineer keeps working-tree safety and engineering practice, but not user authority", async () => {
    // These rules arrive through `sharedPractice`, so the assertion follows them to
    // the composed prompt — this agent cannot rely on a skill being loaded at the
    // model's discretion, and a fragment that stops composing would be invisible.
    // User authority is deliberately absent: this prompt states "You have no user
    // turn", so a policy built on the user confirming and repeating an instruction
    // describes a dialogue that can never happen here.
    const { systemPrompt } = await loadSubAgentDefinition(SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER);

    assertEquals(systemPrompt.includes("After one concern, the discussion is complete. The user decides."), false);
    assertStringIncludes(systemPrompt, "You have no user turn");
    assertStringIncludes(systemPrompt, "`git stash` is the last resort");
    assertStringIncludes(systemPrompt, "The Zero-Trust Implementation Protocol");
    assertStringIncludes(systemPrompt, "No Rogue Commits");
    assertStringIncludes(systemPrompt, "bundled `write-tests` skill");
    assertStringIncludes(systemPrompt, 'Do **NOT** dismiss errors as "pre-existing"');
    // Reached the repair agent for the first time via the shared layer.
    assertStringIncludes(systemPrompt, "report the test-count delta");
});

Deno.test("bundled workflow-only agents cannot name the removed router handoff tool", async () => {
    const removedToolName = ["return", "to", "router"].join("_");
    for (const name of ["reviewer-prompt.md", "reviewer-verify-prompt.md", "reviewer-feedback-engineer.md"]) {
        const prompt = await readBundledPrompt(name);
        assertEquals(prompt.includes(removedToolName), false, `${name} must not reference removed handoff tool`);
    }

    const { systemPrompt } = await loadSubAgentDefinition(SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER);
    assertEquals(
        systemPrompt.includes(removedToolName),
        false,
        "composed reviewer-feedback engineer prompt must not reference removed handoff tool",
    );
});

Deno.test("bundled reviewer-feedback engineer reports unreachable findings as blocked", async () => {
    const prompt = (await readBundledPrompt("reviewer-feedback-engineer.md")).replace(/\s+/g, " ");

    assertStringIncludes(prompt, "Report those as blocked");
    assertStringIncludes(prompt, "do not route around them");
    assertStringIncludes(prompt, "A blocked item is a real, useful outcome");
});
