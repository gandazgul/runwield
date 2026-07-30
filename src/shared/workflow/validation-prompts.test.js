import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadManualQaPrompt, loadReviewerPrompt, runManualQaChecklistPrompt } from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";
import { makeRecordedSession, makeUi } from "./validation-test-helpers.js";

import { __resetSettingsForTests } from "../settings.js";

Deno.test("loadManualQaPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const promptDef = await loadManualQaPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Manual QA",
                'description: "Checklist prompt"',
                "tools: []",
                "---",
                "",
                "Output only a manual verification checklist.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/manual-qa-prompt.md"]);
    assertEquals(promptDef.name, "operator");
    assertEquals(promptDef.displayName, "Manual QA");
    assertEquals(promptDef.tools, []);
    assertEquals(promptDef.systemPrompt, "Output only a manual verification checklist.");
});

Deno.test("bundled Manual QA prompt requires the user checklist shape", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/manual-qa-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Manual verification steps for <plan name>");
    assertStringIncludes(prompt, "- [ ] step 1");
    assertStringIncludes(prompt, "automated verification has already passed");
});

Deno.test("runManualQaChecklistPrompt uses isolated Plan context without tools", async () => {
    /** @type {any} */
    let invocation;
    const expectedMessages = /** @type {any} */ ([{ role: "assistant", content: "checklist" }]);
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    const hostedSession = makeRecordedSession("validation-test", makeUi());
    const result = await runManualQaChecklistPrompt({
        hostedSession,
        name: "settings-panel",
        classification: "PLANNED_CHANGE",
        context: "## Verification Plan\n- Manual: save settings and reload",
        cwd: "/repo",
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: (/** @type {any} */ args) => {
                invocation = args;
                return Promise.resolve(expectedMessages);
            },
        },
    });

    assertEquals(result, expectedMessages);
    assertEquals(invocation.agentName, "operator");
    assertEquals(invocation.cwd, "/repo");
    assertEquals(invocation._agentDefOverride, promptDef);
    assertEquals(invocation.includeEditFallback, false);
    assertEquals(Object.hasOwn(invocation, "useRootSession"), false);
    assertStringIncludes(invocation.userRequest, "Name: settings-panel");
    assertStringIncludes(invocation.userRequest, "Classification: PLANNED_CHANGE");
    assertStringIncludes(invocation.userRequest, "save settings and reload");
});

Deno.test("runManualQaChecklistPrompt persists visible checklist for resume replay", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const entries = [];
    const session = new HostedSession({
        id: "manual-qa-persist",
        cwd: Deno.cwd(),
        sessionManager: /** @type {any} */ ({
            getSessionId: () => "manual-qa-persisted",
            getCwd: () => Deno.cwd(),
            getBranch: () => entries,
            appendCustomEntry: (/** @type {string} */ customType, /** @type {unknown} */ data) => {
                entries.push({ type: "custom", customType, data });
            },
        }),
    });
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    await runManualQaChecklistPrompt({
        hostedSession: session,
        name: "settings-panel",
        classification: "PLANNED_CHANGE",
        context: "context",
        cwd: Deno.cwd(),
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "Manual verification steps for settings-panel" }],
                    }]),
                ),
        },
    });

    assertEquals(entries, [{
        type: "custom",
        customType: "runwield.manual_qa_checklist",
        data: {
            agentName: "Operator",
            text: "Manual verification steps for settings-panel",
            name: "settings-panel",
            classification: "PLANNED_CHANGE",
        },
    }]);
});

Deno.test("loadReviewerPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const reviewerDef = await loadReviewerPrompt(
        "discovery",
        (path) => {
            readPaths.push(String(path));
            return Promise.resolve([
                "---",
                "name: Reviewer",
                'description: "Review prompt"',
                "tools: []",
                "---",
                "",
                "Review only the supplied plan and diff.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/reviewer-prompt.md"]);
    assertEquals(reviewerDef.name, "reviewer");
    assertEquals(reviewerDef.displayName, "Reviewer");
    assertEquals(reviewerDef.tools, []);
    assertEquals(reviewerDef.systemPrompt, "Review only the supplied plan and diff.");
    assertEquals(reviewerDef.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewerDef.systemPrompt.includes("Available tools"), false);
});

Deno.test("loadReviewerPrompt loads the verification prompt for later rounds", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const reviewerDef = await loadReviewerPrompt(
        "verify",
        (path) => {
            readPaths.push(String(path));
            return Promise.resolve([
                "---",
                "name: Reviewer",
                'description: "Verification prompt"',
                "---",
                "",
                "Verify the open findings.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/reviewer-verify-prompt.md"]);
    assertEquals(reviewerDef.systemPrompt, "Verify the open findings.");
});

Deno.test("loadReviewerPrompt retries if the extracted prompt cache is refreshed", async () => {
    /** @type {string[]} */
    const ensuredPaths = [];
    let readAttempts = 0;
    const reviewerDef = await loadReviewerPrompt(
        "discovery",
        (path) => {
            readAttempts++;
            if (readAttempts === 1) throw new Deno.errors.NotFound("cache refresh removed prompt");
            return Promise.resolve([
                "---",
                "name: Reviewer",
                "---",
                "",
                `Recovered prompt from ${path}`,
                "",
            ].join("\n"));
        },
        (relativePath) => {
            ensuredPaths.push(relativePath);
            return Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`);
        },
    );

    assertEquals(ensuredPaths, [
        "workflow-prompts/reviewer-prompt.md",
        "workflow-prompts/reviewer-prompt.md",
    ]);
    assertEquals(readAttempts, 2);
    assertStringIncludes(reviewerDef.systemPrompt, "Recovered prompt");
});

Deno.test("loadReviewerPrompt retries transient partial prompt reads", async () => {
    let readAttempts = 0;
    const reviewerDef = await loadReviewerPrompt(
        "discovery",
        () => {
            readAttempts++;
            if (readAttempts === 1) return Promise.resolve("---\nname: Reviewer");
            return Promise.resolve([
                "---",
                "name: Reviewer",
                "---",
                "",
                "Recovered after partial read.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readAttempts, 2);
    assertEquals(reviewerDef.systemPrompt, "Recovered after partial read.");
});

/** @param {string} name */
function readBundledPrompt(name) {
    return Deno.readTextFile(new URL(`../../agent-definitions/workflow-prompts/${name}`, import.meta.url));
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

Deno.test("bundled reviewer-feedback engineer prompt demands per-item dispositions", async () => {
    const prompt = await readBundledPrompt("reviewer-feedback-engineer.md");

    assertStringIncludes(prompt, "fix the review findings you were given, and report what you did for each one");
    assertStringIncludes(prompt, "You are running in fresh context");
    assertStringIncludes(prompt, "**Your claims are evidence, not resolution.**");
    // The guidelines duplicated from the Engineer must actually be present: this
    // agent cannot rely on a skill being loaded at the model's discretion.
    assertStringIncludes(prompt, "The Zero-Trust Implementation Protocol");
    assertStringIncludes(prompt, "No Rogue Commits");
    assertStringIncludes(prompt, 'Do **NOT** dismiss errors as "pre-existing"');
});

Deno.test("bundled workflow-only agents cannot leave their validation-owned session", async () => {
    // Reviewer and repair agent both run in isolated sessions dispatched by
    // Workflow Validation. `return_to_router` is filtered out of isolated sessions
    // and its result is only ever read from the root conversation, so instructing
    // either agent to call it would promise an escape hatch that silently drops
    // the handoff and strands the validation loop.
    for (const name of ["reviewer-prompt.md", "reviewer-verify-prompt.md", "reviewer-feedback-engineer.md"]) {
        const prompt = await readBundledPrompt(name);
        assertEquals(
            prompt.includes("return_to_router"),
            false,
            `${name} must not reference return_to_router`,
        );
    }
});

Deno.test("bundled reviewer-feedback engineer reports unreachable findings as blocked", async () => {
    const prompt = (await readBundledPrompt("reviewer-feedback-engineer.md")).replace(/\s+/g, " ");

    assertStringIncludes(prompt, "Report those as blocked");
    assertStringIncludes(prompt, "do not route around them");
    assertStringIncludes(prompt, "A blocked item is a real, useful outcome");
});
