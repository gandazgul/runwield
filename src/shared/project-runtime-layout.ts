import { join } from "@std/path";
import {
    getRunWieldRuntimeDir,
    PLAN_LOCKS_DIR_NAME,
    PLAN_STAGING_DIR_NAME,
    PLAN_TRANSITIONS_DIR_NAME,
    PROJECT_INTERNAL_RUNTIME_DIR_NAME,
    WORKTREE_REGISTRY_FILE,
    WORKTREE_REGISTRY_LOCK_FILE,
} from "../constants.js";
import { resolvePrimaryCheckoutRoot } from "./primary-checkout.ts";

export interface PrimaryProjectRuntimeLayout {
    checkoutRoot: string;
    internalRoot: string;
    controllerPlansDir: string;
    worktreeRegistryPath: string;
    worktreeRegistryLockPath: string;
    worktreeRegistryMigrationIssuesPath: string;
    publicationStagingRoot: string;
    projectSecretStorePath: string;
    fallbackWorktreesRoot: string;
}

export interface SelectedProjectRuntimeLayout {
    checkoutRoot: string;
    internalRoot: string;
    planLocksDir: string;
    planCatalogLockPath: string;
    transitionJournalsDir: string;
    workRecordSupersessionLockPath: string;
    workRecordSupersessionRecoveryLockPath: string;
}

export interface ProjectRuntimeLayout {
    primary: PrimaryProjectRuntimeLayout;
    selected: SelectedProjectRuntimeLayout;
}

function internalRootFor(checkoutRoot: string): string {
    return join(getRunWieldRuntimeDir(checkoutRoot), PROJECT_INTERNAL_RUNTIME_DIR_NAME);
}

export function resolveProjectRuntimeLayout(selectedCheckoutRoot: string): ProjectRuntimeLayout {
    const primaryCheckoutRoot = resolvePrimaryCheckoutRoot(selectedCheckoutRoot);
    const primaryInternalRoot = internalRootFor(primaryCheckoutRoot);
    const selectedInternalRoot = internalRootFor(selectedCheckoutRoot);
    const selectedPlanLocksDir = join(selectedInternalRoot, PLAN_LOCKS_DIR_NAME);

    return {
        primary: {
            checkoutRoot: primaryCheckoutRoot,
            internalRoot: primaryInternalRoot,
            controllerPlansDir: join(primaryInternalRoot, "controller", "plans"),
            worktreeRegistryPath: join(primaryInternalRoot, WORKTREE_REGISTRY_FILE),
            worktreeRegistryLockPath: join(primaryInternalRoot, WORKTREE_REGISTRY_LOCK_FILE),
            worktreeRegistryMigrationIssuesPath: join(primaryInternalRoot, "worktree-registry-migration-issues.json"),
            publicationStagingRoot: join(primaryInternalRoot, PLAN_STAGING_DIR_NAME),
            projectSecretStorePath: join(primaryInternalRoot, "collaboration-secrets.json"),
            fallbackWorktreesRoot: join(primaryInternalRoot, "worktrees"),
        },
        selected: {
            checkoutRoot: selectedCheckoutRoot,
            internalRoot: selectedInternalRoot,
            planLocksDir: selectedPlanLocksDir,
            planCatalogLockPath: join(selectedPlanLocksDir, "catalog.lock"),
            transitionJournalsDir: join(selectedInternalRoot, PLAN_TRANSITIONS_DIR_NAME),
            workRecordSupersessionLockPath: join(selectedInternalRoot, "work-record-supersession.lock"),
            workRecordSupersessionRecoveryLockPath: join(
                selectedInternalRoot,
                "work-record-supersession-recovery.lock",
            ),
        },
    };
}
