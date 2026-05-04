/**
 * @module cmd/router
 * Router command implementation (also used as default command).
 */

import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/chat-session.js";
import { COMMAND_NAMES, CWD } from "../../constants.js";
import { ensurePlansDir as ensurePlansDirFn } from "../../plan-store.js";
import { triageReportTool as triageReportToolFn } from "../../tools/triage-report.js";
import { planWrittenTool as planWrittenToolFn } from "../../tools/plan-written.js";
import { createUserInterviewTool as createUserInterviewToolFn } from "../../tools/user-interview.js";
import { runAgentSession as runAgentSessionFn } from "../../shared/session/session.js";
import { extractTriageReport as extractTriageReportFn } from "./triage.js";
import { runPlanLifecycle as runPlanLifecycleFn } from "../../shared/workflow/workflow.js";
import { createDirectAgentHandler as createDirectAgentHandlerFn } from "../../shared/direct-agent.js";
import { buildRepairPrompt as buildRepairPromptFn } from "../command-helpers.js";

/**
 * @typedef {Object} RunRouterCommandDeps
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 */

/**
 * Handle router/default command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: RunRouterCommandDeps }} [options]
 */
export async function runRouterCommand(argv, options = {}) {
    const deps = /** @type {RunRouterCommandDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        printCommandHelp: printCommandHelpDep,
        startInteractiveSession: startInteractiveSessionDep,
    } = deps;

    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;

    const userRequest = argv.join(" ").trim();

    if (userRequest === "help") {
        printCommandHelp(COMMAND_NAMES.ROUTER);
        return;
    }

    // Launch the interactive loop with the router as the default handler
    // The loop inside startInteractiveSession will call setActiveAgent
    await startInteractiveSession(userRequest, routerCmdOnMessage, {
        sessionStartMode: options.sessionStartMode || "new",
    });
}

/**
 * @typedef RouterCmdTestDeps
 * @property {typeof ensurePlansDirFn} [ensurePlansDir]
 * @property {typeof runAgentSessionFn} [runAgentSession]
 * @property {typeof extractTriageReportFn} [extractTriageReport]
 * @property {typeof createUserInterviewToolFn} [createUserInterviewTool]
 * @property {typeof runPlanLifecycleFn} [runPlanLifecycle]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 * @property {typeof buildRepairPromptFn} [buildRepairPrompt]
 * @property {typeof triageReportToolFn} [triageReportTool]
 * @property {typeof planWrittenToolFn} [planWrittenTool]
 */

/**
 * Handle router logic inside the interactive loop.
 *
 * @param {string} userRequest
 * @param {Array<{base64: string, mimeType: string}>} images
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [sessionManager]
 * @param {RouterCmdTestDeps} [testDeps]
 */
export async function routerCmdOnMessage(userRequest, images, uiAPI, sessionManager, testDeps = {}) {
    const {
        ensurePlansDir: ensurePlansDirDep,
        runAgentSession: runAgentSessionDep,
        extractTriageReport: extractTriageReportDep,
        createUserInterviewTool: createUserInterviewToolDep,
        runPlanLifecycle: runPlanLifecycleDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
        buildRepairPrompt: buildRepairPromptDep,
        triageReportTool: triageReportToolDep,
        planWrittenTool: planWrittenToolDep,
    } = testDeps;

    const ensurePlansDir = ensurePlansDirDep || ensurePlansDirFn;
    const runAgentSession = runAgentSessionDep || runAgentSessionFn;
    const extractTriageReport = extractTriageReportDep || extractTriageReportFn;
    const createUserInterviewTool = createUserInterviewToolDep || createUserInterviewToolFn;
    const runPlanLifecycle = runPlanLifecycleDep || runPlanLifecycleFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;
    const buildRepairPrompt = buildRepairPromptDep || buildRepairPromptFn;
    const triageReportToolDef = triageReportToolDep || triageReportToolFn;
    const planWrittenToolDef = planWrittenToolDep || planWrittenToolFn;

    await ensurePlansDir(CWD);

    uiAPI.appendSystemMessage("=== Phase A: Router (Triage) ===");

    const routerMessages = await runAgentSession({
        agentName: "router",
        customTools: [triageReportToolDef],
        userRequest,
        images,
        uiAPI,
        sessionManager,
    });

    const triage = extractTriageReport(routerMessages);

    if (!triage) {
        const lastAssistant = routerMessages.slice().reverse().find((m) => m.role === "assistant");
        if (lastAssistant && lastAssistant.stopReason === "error") {
            uiAPI.appendSystemMessage(
                `Router error: ${lastAssistant.errorMessage || "Unknown LLM error"}`,
                true,
            );
        } else {
            uiAPI.appendSystemMessage("ERROR: Router did not produce a triage report.", true);
        }
        return;
    }

    uiAPI.appendSystemMessage(
        `[Router] Classification: ${triage.classification}, ` +
            `Complexity: ${triage.complexity}. ` +
            `Summary: ${triage.summary}`,
    );

    if (triage.classification === "QUICK_FIX") {
        uiAPI.appendSystemMessage("QUICK_FIX detected. Handing off to Operator...");
        uiAPI.appendSystemMessage("=== Phase B: Operator (Execute) ===");

        const operatorRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
        ].join("\n");

        await runAgentSession({
            agentName: "operator",
            userRequest: operatorRequest,
            uiAPI,
        });

        uiAPI.appendSystemMessage("✅ Operator execution complete.");

        if (sessionManager) {
            sessionManager.appendCustomMessageEntry(
                "system",
                "Quick fix executed by operator.",
                true,
                `Quick fix executed by operator. Summary:\n${triage.summary}`,
            );
        }
        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        return;
    }

    if (triage.classification === "FEATURE") {
        uiAPI.appendSystemMessage("FEATURE detected. Handing off to Planner...");

        const plannerRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
            "Based on the triage report above, explore the affected files and create a plan in the plans/ directory.",
            "Before finalizing, ask clarification questions via user_interview when requirements are ambiguous.",
            "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
            "Choose a descriptive, kebab-case filename (e.g., plans/add-dark-mode-toggle.md).",
        ].join("\n");

        const lifecycle = await runPlanLifecycle({
            agentName: "planner",
            customTools: [planWrittenToolDef, createUserInterviewTool(uiAPI)],
            initialRequest: plannerRequest,
            triageMeta: triage,
            uiAPI,
            buildRepairPrompt,
        });

        if (lifecycle.status === "executed" && lifecycle.planName) {
            if (sessionManager) {
                sessionManager.appendCustomMessageEntry(
                    "system",
                    `FEATURE plan executed: plans/${lifecycle.planName}.md.`,
                    true,
                    `FEATURE plan executed: plans/${lifecycle.planName}.md. Summary: ${triage.summary}`,
                );
            }
            setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        } else if (lifecycle.status === "saved" && lifecycle.planName) {
            if (sessionManager) {
                sessionManager.appendCustomMessageEntry(
                    "system",
                    `FEATURE plan generated and saved: plans/${lifecycle.planName}.md.`,
                    true,
                    `FEATURE plan generated and saved: plans/${lifecycle.planName}.md. User decided to execute later.`,
                );
            }
        } else if (lifecycle.status === "canceled") {
            setActiveAgent("Planner", createDirectAgentHandler("planner"), uiAPI);
        }
        return;
    }

    if (triage.classification === "PROJECT") {
        uiAPI.appendSystemMessage(
            "PROJECT detected. Handing off to Architect for targeted deep exploration + planning...",
        );
        uiAPI.appendSystemMessage(
            "=== Phase D: Architect (Targeted Explore + Plan + Review) ===",
        );

        const architectRequest = [
            "## User Request",
            userRequest,
            "",
            "## Triage Report",
            `- Classification: ${triage.classification}`,
            `- Complexity: ${triage.complexity}`,
            `- Summary: ${triage.summary}`,
            `- Affected paths: ${triage.affectedPaths.join(", ")}`,
            "",
            "Start with a targeted vertical-slice exploration from the triage input (especially affected paths).",
            "Go deep on the request-related execution path; avoid broad repo surveys.",
            "Then produce a comprehensive plan in plans/ with a descriptive kebab-case filename.",
            "Before finalizing, ask clarification questions via user_interview when needed.",
            "Ask either one question or a focused batch of 1-3 questions, then incorporate the answers.",
            "Since this is a PROJECT, include a Tasks table for multi-agent execution.",
        ].join("\n");

        const lifecycle = await runPlanLifecycle({
            agentName: "architect",
            customTools: [planWrittenToolDef, createUserInterviewTool(uiAPI)],
            initialRequest: architectRequest,
            triageMeta: triage,
            uiAPI,
            buildRepairPrompt,
        });

        if (lifecycle.status === "executed" && lifecycle.planName) {
            if (sessionManager) {
                sessionManager.appendCustomMessageEntry(
                    "system",
                    `PROJECT plan executed: plans/${lifecycle.planName}.md.`,
                    true,
                    `PROJECT plan executed: plans/${lifecycle.planName}.md. Summary: ${triage.summary}`,
                );
            }
            setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        } else if (lifecycle.status === "saved" && lifecycle.planName) {
            if (sessionManager) {
                sessionManager.appendCustomMessageEntry(
                    "system",
                    `PROJECT plan generated and saved: plans/${lifecycle.planName}.md.`,
                    true,
                    `PROJECT plan generated and saved: plans/${lifecycle.planName}.md. User decided to execute later.`,
                );
            }
        } else if (lifecycle.status === "canceled") {
            setActiveAgent("Architect", createDirectAgentHandler("architect"), uiAPI);
        }
    }
}
