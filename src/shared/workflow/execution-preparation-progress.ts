import { emitSystemStatus } from "../session/session-runtime-events.js";
import type { HostedSession } from "../session/hosted-session.js";

export interface ExecutionWorktreeProgressDetails {
    worktreeBranch: string;
    baseBranch?: string;
}

function baseBranchLabel(baseBranch?: string): string {
    const trimmed = baseBranch?.trim();
    return trimmed ? trimmed : "HEAD";
}

function emitExecutionPreparationStatus(hostedSession: HostedSession | undefined, message: string): boolean {
    return emitSystemStatus(hostedSession, message, { header: "RunWield" });
}

export function emitPreparingExecutionTarget(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "preparing execution target...");
}

export function emitPreparingInPlaceExecution(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "preparing in-place execution because Git is unavailable...");
}

export function emitCreatingExecutionWorktree(
    hostedSession: HostedSession | undefined,
    baseBranch?: string,
): boolean {
    return emitExecutionPreparationStatus(
        hostedSession,
        `creating execution worktree from base branch ${baseBranchLabel(baseBranch)}...`,
    );
}

export function emitCreatedExecutionWorktree(
    hostedSession: HostedSession | undefined,
    details: ExecutionWorktreeProgressDetails,
): boolean {
    return emitExecutionPreparationStatus(
        hostedSession,
        `created worktree ${details.worktreeBranch} from base branch ${baseBranchLabel(details.baseBranch)}.`,
    );
}

export function emitReusingExecutionWorktree(
    hostedSession: HostedSession | undefined,
    details: ExecutionWorktreeProgressDetails,
): boolean {
    return emitExecutionPreparationStatus(
        hostedSession,
        `reusing worktree ${details.worktreeBranch} from base branch ${baseBranchLabel(details.baseBranch)}.`,
    );
}

export function emitIndexingExecutionWorktree(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "indexing execution worktree for code search...");
}

export function emitExecutionWorktreeIndexWarning(
    hostedSession: HostedSession | undefined,
    reason: string,
): boolean {
    return emitSystemStatus(hostedSession, `Cymbal index did not complete: ${reason}`, {
        header: "RunWield",
        level: "warning",
    });
}

export function emitMaterializingPlanInExecutionWorktree(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "materializing Plan in execution worktree...");
}

export function emitRestoredPlanInExecutionWorktree(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "restored missing Plan file in execution worktree.");
}

export function emitReconciledPlanInExecutionWorktree(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "reconciled Plan file in execution worktree.");
}

export function emitUpdatingPlanStatusToInProgress(hostedSession: HostedSession | undefined): boolean {
    return emitExecutionPreparationStatus(hostedSession, "updating Plan status to in_progress...");
}

export function emitLaunchingExecutionAgent(
    hostedSession: HostedSession | undefined,
    agentDisplayName: string,
): boolean {
    return emitExecutionPreparationStatus(hostedSession, `launching ${agentDisplayName} to execute...`);
}
