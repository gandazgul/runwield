/**
 * @module shared/attached/attached-test-fixture
 * Operation inputs and a real `wld attached` subprocess runner for Attached tests.
 */

import { fromFileUrl, join } from "@std/path";
import { defineCommittedGitFixture } from "../git-test-fixture.ts";
import type { AttachedJsonObject, AttachedOperationName, AttachedOperationResult } from "./operations.ts";
import { locateAttachedWorkflows } from "./record-store.ts";

export const REPO_ROOT = fromFileUrl(new URL("../../../", import.meta.url));
export const CLI_PATH = join(REPO_ROOT, "src", "cli.ts");
export const DENO_CONFIG_PATH = join(REPO_ROOT, "deno.json");

/** An uninitialized Project: one commit, no `.wld/`, no `.gitignore`. */
export const projectFixture = defineCommittedGitFixture({ "README.md": "# Fixture\n" });

export const EVIDENCE = { host: "claude-code", hostVersion: "2.1.0", adapterVersion: "0.1.0" };

export function activateInput(operationId = "op-activate"): AttachedJsonObject {
    return {
        operationId,
        evidence: EVIDENCE,
        payload: { requestText: "Add a dark mode toggle", hostRequestId: "host-request-1" },
    };
}

export interface SubmitInputOptions {
    workflowId: string;
    actionId: string;
    expectedRevision?: number;
    operationId?: string;
    outcome?: AttachedJsonObject;
}

export function submitInput(options: SubmitInputOptions): AttachedJsonObject {
    return {
        operationId: options.operationId ?? "op-submit",
        workflowId: options.workflowId,
        expectedRevision: options.expectedRevision ?? 1,
        evidence: EVIDENCE,
        payload: {
            actionId: options.actionId,
            outcome: options.outcome ??
                { routingIntent: "PLANNED_CHANGE", workKind: "FEATURE", complexity: "MEDIUM", summary: "Add a toggle" },
        },
    };
}

/** The Triage action an accepted activation handed to the host. */
export function pendingTriage(result: AttachedOperationResult): { workflowId: string; actionId: string } {
    if (!result.ok || result.workflow.nextAction.kind !== "triage") {
        throw new Error(`Expected a pending Triage action, got ${JSON.stringify(result)}`);
    }
    return { workflowId: result.workflow.workflowId, actionId: result.workflow.nextAction.actionId };
}

export async function readRecordBytes(projectRoot: string, workflowId: string): Promise<string> {
    return await Deno.readTextFile(join(locateAttachedWorkflows(projectRoot).workflowsDir, `${workflowId}.json`));
}

export interface CliRun {
    code: number;
    result: AttachedOperationResult;
    stderr: string;
}

/** Spawn a fresh `wld attached <operation>` Core process in `projectRoot`. */
export async function spawnAttachedCli(
    operation: AttachedOperationName,
    projectRoot: string,
    input: AttachedJsonObject,
): Promise<CliRun> {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--quiet", "--no-check", "--config", DENO_CONFIG_PATH, CLI_PATH, "attached", operation],
        cwd: projectRoot,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(input)));
    await writer.close();
    const finished = await child.output();
    const stdout = new TextDecoder().decode(finished.stdout);
    const stderr = new TextDecoder().decode(finished.stderr);
    try {
        const result: AttachedOperationResult = JSON.parse(stdout);
        return { code: finished.code, result, stderr };
    } catch {
        throw new Error(`wld attached ${operation} printed no JSON result.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
}
