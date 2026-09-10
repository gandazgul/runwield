import { basename, dirname, join, resolve } from "@std/path";
import {
    getRunWieldRuntimeDir,
    PLAN_BACKUPS_DIR_NAME,
    PLAN_LOCKS_DIR_NAME,
    PLAN_STAGING_DIR_NAME,
    PLAN_TRANSITIONS_DIR_NAME,
    PROJECT_INTERNAL_RUNTIME_DIR_NAME,
    RUNWIELD_DIR_NAME,
    WORKTREE_REGISTRY_FILE,
    WORKTREE_REGISTRY_LOCK_FILE,
} from "../constants.js";
import { PROJECT_SECRET_STORE_RELATIVE_PATH } from "./collaboration/secrets.js";
import {
    type LockFileSnapshot,
    lockFileSnapshotMatches,
    readLockFileSnapshot,
    removeLockFileIfSnapshotMatches,
} from "./lock-file-snapshot.ts";
import { getLockHostname, isLockHolderGone } from "./process-liveness.ts";
import { resolvePrimaryCheckoutRoot } from "./primary-checkout.ts";
import { LEGACY_PROJECT_RUNTIME_HAZARD_PATHS } from "./runwield-owned-paths.ts";
import { inspectWorktreeRegistryAtPath, withWorktreeRegistryLockAtPath } from "./worktree-registry.js";
import {
    assertPublicationAttempt,
    isPublicationAttemptCleanupComplete,
    type PublicationAttempt,
} from "./workflow/publication-attempt.ts";

export interface PrimaryProjectRuntimeLayout {
    checkoutRoot: string;
    internalRoot: string;
    layoutMarkerPath: string;
    layoutMigrationJournalPath: string;
    layoutMigrationLockPath: string;
    controllerPlansDir: string;
    worktreeRegistryPath: string;
    worktreeRegistryLockPath: string;
    worktreeRegistryMigrationIssuesPath: string;
    publicationStagingRoot: string;
    projectSecretStorePath: string;
    fallbackWorktreesRoot: string;
    debugRoot: string;
}

export interface SelectedProjectRuntimeLayout {
    checkoutRoot: string;
    internalRoot: string;
    planLocksDir: string;
    planCatalogLockPath: string;
    transitionJournalsDir: string;
    planBackupsDir: string;
    workRecordSupersessionLockPath: string;
    workRecordSupersessionRecoveryLockPath: string;
}

export interface ProjectRuntimeLayout {
    primary: PrimaryProjectRuntimeLayout;
    selected: SelectedProjectRuntimeLayout;
}

export type ProjectRuntimeMigrationBlockedReason =
    | "newer_layout"
    | "malformed_migration_evidence"
    | "authority_conflict"
    | "active_legacy_writer"
    | "malformed_registry"
    | "unfinished_publication"
    | "saved_repair_root"
    | "tracked_runtime"
    | "tracked_secret"
    | "symlink"
    | "invalid_registered_checkout"
    | "unsupported_filesystem_move";

export interface ProjectRuntimeMigrationSecurityAction {
    rotateCapabilities: boolean;
    removeFromRepositoryHistory: boolean;
    message: string;
}

export interface ProjectRuntimeMigrationReadyResult {
    kind: "ready";
    layout: ProjectRuntimeLayout;
    migrated: boolean;
    adoptedSelectedCheckoutRoots: string[];
}

export interface ProjectRuntimeMigrationBlockedResult {
    kind: "blocked";
    reason: ProjectRuntimeMigrationBlockedReason;
    paths: string[];
    message: string;
    securityAction?: ProjectRuntimeMigrationSecurityAction;
}

export type ProjectRuntimeMigrationResult =
    | ProjectRuntimeMigrationReadyResult
    | ProjectRuntimeMigrationBlockedResult;

type PathKind = "file" | "directory";

type MigrationRenameOperation = {
    action: "rename";
    source: string;
    destination: string;
    kind: PathKind;
    completed: boolean;
};

type LockSnapshot = LockFileSnapshot;

type MigrationRetireOperation = {
    action: "retire";
    source: string;
    kind: PathKind;
    proof: LockSnapshot;
    completed: boolean;
};

type MigrationOperation = MigrationRenameOperation | MigrationRetireOperation;

type MigrationJournal = {
    version: 1;
    primaryCheckoutRoot: string;
    selectedCheckoutRoots: string[];
    operations: MigrationOperation[];
    updatedAt: string;
};

type LayoutMarker = {
    version: 1;
    primaryCheckoutRoot: string;
    adoptedSelectedCheckoutRoots: string[];
    completedAt: string;
};

type LegacyRegistryEntry = {
    id: string;
    planName: string;
    planId?: string;
    baseBranch: string;
    baseRef: string;
    baseCommit: string;
    branch: string;
    path: string;
    status: string;
    publication?: PublicationAttempt;
};

type MigrationPreflight = {
    layout: ProjectRuntimeLayout;
    primaryCheckoutRoot: string;
    selectedCheckoutRoots: string[];
    entries: LegacyRegistryEntry[];
    operations: MigrationOperation[];
};

type GitWorktree = {
    path: string;
    realPath: string;
    branch: string;
};

type ExistingEntry = {
    path: string;
    info: Deno.FileInfo;
};

type LegacyLockStatus = {
    active: string[];
    retire: MigrationRetireOperation[];
};

type WorkRecordLockDocument = {
    token: string;
    createdAt: number;
    updatedAt: number;
};

const LAYOUT_MARKER_FILE = "layout.json";
const MIGRATION_JOURNAL_FILE = "layout-migration.json";
const MIGRATION_LOCK_FILE = "layout-migration.lock";
const LAYOUT_VERSION = 1;
const MIGRATION_LOCK_STALE_MS = 30_000;
const MIGRATION_LOCK_HEARTBEAT_MS = 10_000;
const PLAN_LOCK_STALE_MS = 10 * 60_000;
const WORK_RECORD_LOCK_STALE_MS = 10 * 60_000;
const WORK_RECORD_RECOVERY_LOCK_STALE_MS = 30_000;
const WORK_RECORD_LOCK_WAIT_TIMEOUT_MS = 5 * 60_000;
const WORK_RECORD_LOCK_RETRY_MS = 50;
const WORK_RECORD_LOCK_HEARTBEAT_MS = 10_000;

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
            layoutMarkerPath: join(primaryInternalRoot, LAYOUT_MARKER_FILE),
            layoutMigrationJournalPath: join(primaryInternalRoot, MIGRATION_JOURNAL_FILE),
            layoutMigrationLockPath: join(primaryInternalRoot, MIGRATION_LOCK_FILE),
            controllerPlansDir: join(primaryInternalRoot, "controller", "plans"),
            worktreeRegistryPath: join(primaryInternalRoot, WORKTREE_REGISTRY_FILE),
            worktreeRegistryLockPath: join(primaryInternalRoot, WORKTREE_REGISTRY_LOCK_FILE),
            worktreeRegistryMigrationIssuesPath: join(primaryInternalRoot, "worktree-registry-migration-issues.json"),
            publicationStagingRoot: join(primaryInternalRoot, PLAN_STAGING_DIR_NAME),
            projectSecretStorePath: join(primaryInternalRoot, "collaboration-secrets.json"),
            fallbackWorktreesRoot: join(primaryInternalRoot, "worktrees"),
            debugRoot: join(primaryInternalRoot, "debug"),
        },
        selected: {
            checkoutRoot: selectedCheckoutRoot,
            internalRoot: selectedInternalRoot,
            planLocksDir: selectedPlanLocksDir,
            planCatalogLockPath: join(selectedPlanLocksDir, "catalog.lock"),
            transitionJournalsDir: join(selectedInternalRoot, PLAN_TRANSITIONS_DIR_NAME),
            planBackupsDir: join(selectedInternalRoot, PLAN_BACKUPS_DIR_NAME),
            workRecordSupersessionLockPath: join(selectedInternalRoot, "work-record-supersession.lock"),
            workRecordSupersessionRecoveryLockPath: join(
                selectedInternalRoot,
                "work-record-supersession-recovery.lock",
            ),
        },
    };
}

export async function migrateLegacyProjectRuntimeState(
    selectedCheckoutRoot: string,
): Promise<ProjectRuntimeMigrationResult> {
    const layout = resolveProjectRuntimeLayout(selectedCheckoutRoot);
    const primaryCheckoutRoot = await canonicalExistingRoot(layout.primary.checkoutRoot);
    const earlySymlink = await findSymlinkBlocker(layout, primaryCheckoutRoot, [layout.selected.checkoutRoot]);
    if (earlySymlink.length > 0) {
        return block(
            "symlink",
            earlySymlink,
            "A runtime authority uses a symlink. Migration stopped before reading it.",
        );
    }

    const marker = await readLayoutMarker(layout);
    if (isBlocked(marker)) return marker;

    const beforeLock = await preflight(layout, primaryCheckoutRoot, marker.marker);
    if (isBlocked(beforeLock)) return beforeLock;
    const unchanged = await completeMarkerNeedsNoWork(layout, marker.marker, beforeLock);
    if (unchanged && marker.marker) {
        return {
            kind: "ready",
            layout,
            migrated: false,
            adoptedSelectedCheckoutRoots: marker.marker.adoptedSelectedCheckoutRoots,
        };
    }

    const lock = await acquireMigrationLock(layout.primary.layoutMigrationLockPath);
    let cleanupInternalRoot = false;
    try {
        const lockedMarker = await readLayoutMarker(layout);
        if (isBlocked(lockedMarker)) return lockedMarker;
        return await withWorktreeRegistryLockAtPath(legacyWorktreeRegistryLockPath(primaryCheckoutRoot), async () => {
            const locked = await preflight(layout, primaryCheckoutRoot, lockedMarker.marker, {
                legacyRegistryLockHeld: true,
            });
            if (isBlocked(locked)) {
                cleanupInternalRoot = true;
                return locked;
            }
            const lockedUnchanged = await completeMarkerNeedsNoWork(layout, lockedMarker.marker, locked, {
                ignoreMigrationLock: true,
            });
            if (lockedUnchanged && lockedMarker.marker) {
                await Deno.remove(layout.primary.layoutMigrationJournalPath).catch((error) => {
                    if (!(error instanceof Deno.errors.NotFound)) throw error;
                });
                return {
                    kind: "ready",
                    layout,
                    migrated: false,
                    adoptedSelectedCheckoutRoots: lockedMarker.marker.adoptedSelectedCheckoutRoots,
                };
            }
            const journal = await readOrCreateJournal(layout, locked);
            if (isBlocked(journal)) return journal;
            const replay = await replayJournal(layout, journal.journal);
            if (isBlocked(replay)) return replay;
            const adoptedSelectedCheckoutRoots = mergedSelectedRoots(lockedMarker.marker, locked.selectedCheckoutRoots);
            await writeLayoutMarker(layout.primary.layoutMarkerPath, {
                version: LAYOUT_VERSION,
                primaryCheckoutRoot,
                adoptedSelectedCheckoutRoots,
                completedAt: new Date().toISOString(),
            });
            await Deno.remove(layout.primary.layoutMigrationJournalPath).catch((error) => {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            });
            return { kind: "ready", layout, migrated: true, adoptedSelectedCheckoutRoots };
        });
    } finally {
        await lock.release();
        if (cleanupInternalRoot) await removeEmptyDirectory(layout.primary.internalRoot);
    }
}

function isBlocked<T>(value: T | ProjectRuntimeMigrationBlockedResult): value is ProjectRuntimeMigrationBlockedResult {
    return typeof value === "object" && value !== null && "kind" in value && value.kind === "blocked";
}

function block(
    reason: ProjectRuntimeMigrationBlockedReason,
    paths: string[],
    message: string,
    securityAction?: ProjectRuntimeMigrationSecurityAction,
): ProjectRuntimeMigrationBlockedResult {
    return {
        kind: "blocked",
        reason,
        paths: [...new Set(paths)].sort(),
        message,
        ...(securityAction ? { securityAction } : {}),
    };
}

async function canonicalExistingRoot(path: string): Promise<string> {
    try {
        return await Deno.realPath(path);
    } catch {
        return resolve(path);
    }
}

function legacyRuntimeBase(checkoutRoot: string): string {
    return getRunWieldRuntimeDir(checkoutRoot);
}

function legacyWorktreeRegistryPath(primaryCheckoutRoot: string): string {
    return join(legacyRuntimeBase(primaryCheckoutRoot), WORKTREE_REGISTRY_FILE);
}

function legacyWorktreeRegistryLockPath(primaryCheckoutRoot: string): string {
    return join(legacyRuntimeBase(primaryCheckoutRoot), WORKTREE_REGISTRY_LOCK_FILE);
}

function legacyRelativePath(checkoutRoot: string, path: string): string {
    return join(legacyRuntimeBase(checkoutRoot), path.replace(/^\.wld\//, ""));
}

async function readLayoutMarker(
    layout: ProjectRuntimeLayout,
): Promise<{ marker: LayoutMarker | null } | ProjectRuntimeMigrationBlockedResult> {
    try {
        const parsed = JSON.parse(await Deno.readTextFile(layout.primary.layoutMarkerPath));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMarkerPath],
                "The project runtime layout marker is malformed.",
            );
        }
        if (typeof parsed.version !== "number") {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMarkerPath],
                "The project runtime layout marker has no version.",
            );
        }
        if (parsed.version > LAYOUT_VERSION) {
            return block(
                "newer_layout",
                [layout.primary.layoutMarkerPath],
                "This project was opened by a newer RunWield runtime layout.",
            );
        }
        if (
            parsed.version !== LAYOUT_VERSION || typeof parsed.primaryCheckoutRoot !== "string" ||
            !Array.isArray(parsed.adoptedSelectedCheckoutRoots) || typeof parsed.completedAt !== "string" ||
            !parsed.adoptedSelectedCheckoutRoots.every((root: string) => typeof root === "string")
        ) {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMarkerPath],
                "The project runtime layout marker is malformed.",
            );
        }
        return { marker: parsed as LayoutMarker };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { marker: null };
        if (error instanceof SyntaxError) {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMarkerPath],
                "The project runtime layout marker is not valid JSON.",
            );
        }
        throw error;
    }
}

async function completeMarkerNeedsNoWork(
    layout: ProjectRuntimeLayout,
    marker: LayoutMarker | null,
    preflightResult: MigrationPreflight,
    options: { ignoreMigrationLock?: boolean } = {},
): Promise<boolean> {
    if (
        !marker || preflightResult.operations.length !== 0 ||
        !preflightResult.selectedCheckoutRoots.every((root) => marker.adoptedSelectedCheckoutRoots.includes(root))
    ) return false;
    return !(await lstatOrNull(layout.primary.layoutMigrationJournalPath)) &&
        (options.ignoreMigrationLock || !(await lstatOrNull(layout.primary.layoutMigrationLockPath)));
}

async function preflight(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    marker: LayoutMarker | null,
    options: { legacyRegistryLockHeld?: boolean } = {},
): Promise<MigrationPreflight | ProjectRuntimeMigrationBlockedResult> {
    const markerCheck = await validateMarkerRoots(layout, primaryCheckoutRoot, marker);
    if (isBlocked(markerCheck)) return markerCheck;

    const existingJournal = await readJournal(layout.primary.layoutMigrationJournalPath);
    if (isBlocked(existingJournal)) return existingJournal;

    const symlink = await findSymlinkBlocker(layout, primaryCheckoutRoot, [
        layout.selected.checkoutRoot,
        ...(existingJournal.journal?.selectedCheckoutRoots || []),
    ]);
    if (symlink.length > 0) {
        return block(
            "symlink",
            symlink,
            "A legacy runtime authority uses a symlink. Migration stopped before reading it.",
        );
    }

    const registry = await inspectWorktreeRegistryAtPath(legacyWorktreeRegistryPath(primaryCheckoutRoot));
    if (registry.readError) {
        return block(
            "malformed_registry",
            [legacyWorktreeRegistryPath(primaryCheckoutRoot)],
            `The legacy worktree registry cannot be read: ${registry.readError.message}`,
        );
    }
    if (registry.integrityIssues.length > 0) {
        return block(
            "malformed_registry",
            [legacyWorktreeRegistryPath(primaryCheckoutRoot)],
            registry.integrityIssues[0].message,
        );
    }

    const publication = await inspectPublicationSafety(primaryCheckoutRoot, registry.entries);
    if (isBlocked(publication)) return publication;

    const gitWorktrees = await listGitWorktrees(primaryCheckoutRoot);
    if (isBlocked(gitWorktrees)) return gitWorktrees;
    const selectedRoots = await resolveSelectedRoots(
        layout.selected.checkoutRoot,
        registry.entries,
        gitWorktrees.worktrees,
        existingJournal.journal?.selectedCheckoutRoots || [],
    );
    if (isBlocked(selectedRoots)) return selectedRoots;
    const markerSelectedRoots = validateMarkerSelectedRoots(layout, marker, gitWorktrees.worktrees);
    if (isBlocked(markerSelectedRoots)) return markerSelectedRoots;

    const selectedSymlink = await findSymlinkBlocker(layout, primaryCheckoutRoot, selectedRoots.roots);
    if (selectedSymlink.length > 0) {
        return block(
            "symlink",
            selectedSymlink,
            "A runtime authority uses a symlink. Migration stopped before reading it.",
        );
    }

    const tracked = await findTrackedRuntimePaths(primaryCheckoutRoot, selectedRoots.roots);
    if (isBlocked(tracked)) return tracked;
    if (tracked.secretPaths.length > 0) {
        return block(
            "tracked_secret",
            tracked.secretPaths,
            "A project collaboration secret is tracked by Git. Remove it from Git history and rotate the capability before migration.",
            {
                rotateCapabilities: true,
                removeFromRepositoryHistory: true,
                message:
                    "Rotate shared-space capabilities and remove the secret from repository history before retrying.",
            },
        );
    }
    if (tracked.runtimePaths.length > 0) {
        return block(
            "tracked_runtime",
            tracked.runtimePaths,
            "RunWield runtime paths are tracked or staged by Git. Untrack them before migration.",
        );
    }

    const currentConflict = await findCurrentAuthorityConflicts(
        layout,
        primaryCheckoutRoot,
        selectedRoots.roots,
        marker,
        existingJournal.journal,
    );
    if (currentConflict.length > 0) {
        return block(
            "authority_conflict",
            currentConflict,
            "New `.wld/internal/` runtime state already exists without matching migration evidence.",
        );
    }

    const legacyLocks = await inspectLegacyLocks(primaryCheckoutRoot, selectedRoots.roots, options);
    if (legacyLocks.active.length > 0) {
        return block(
            "active_legacy_writer",
            legacyLocks.active,
            "A legacy RunWield writer is still active. Finish or stop it, then retry migration.",
        );
    }

    const legacyProblems = await validateLegacyAuthorities(primaryCheckoutRoot, selectedRoots.roots);
    if (isBlocked(legacyProblems)) return legacyProblems;

    const operations = await buildOperations(primaryCheckoutRoot, selectedRoots.roots, legacyLocks.retire, marker);
    return {
        layout,
        primaryCheckoutRoot,
        selectedCheckoutRoots: selectedRoots.roots,
        entries: registry.entries,
        operations,
    };
}

async function validateMarkerRoots(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    marker: LayoutMarker | null,
): Promise<ProjectRuntimeMigrationBlockedResult | undefined> {
    if (!marker) return undefined;
    if (marker.primaryCheckoutRoot !== primaryCheckoutRoot) {
        return block(
            "malformed_migration_evidence",
            [layout.primary.layoutMarkerPath],
            "The project runtime layout marker names a different primary checkout root.",
        );
    }
    const sorted = [...marker.adoptedSelectedCheckoutRoots].sort();
    if (
        marker.adoptedSelectedCheckoutRoots.length !== new Set(marker.adoptedSelectedCheckoutRoots).size ||
        marker.adoptedSelectedCheckoutRoots.some((root, index) => root !== sorted[index])
    ) {
        return block(
            "malformed_migration_evidence",
            [layout.primary.layoutMarkerPath],
            "The project runtime layout marker has unsorted or duplicate selected checkout roots.",
        );
    }
    for (const root of marker.adoptedSelectedCheckoutRoots) {
        if (root !== await canonicalExistingRoot(root)) {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMarkerPath, root],
                "The project runtime layout marker contains a noncanonical selected checkout root.",
            );
        }
    }
    return undefined;
}

function validateMarkerSelectedRoots(
    layout: ProjectRuntimeLayout,
    marker: LayoutMarker | null,
    gitWorktrees: GitWorktree[],
): ProjectRuntimeMigrationBlockedResult | undefined {
    if (!marker) return undefined;
    const byRealPath = new Set(gitWorktrees.map((worktree) => worktree.realPath));
    const missing = marker.adoptedSelectedCheckoutRoots.filter((root) => !byRealPath.has(root));
    if (missing.length > 0) {
        return block(
            "malformed_migration_evidence",
            [layout.primary.layoutMarkerPath, ...missing],
            "The project runtime layout marker names a selected checkout outside this Git worktree set.",
        );
    }
    return undefined;
}

async function listGitWorktrees(
    primaryCheckoutRoot: string,
): Promise<{ worktrees: GitWorktree[] } | ProjectRuntimeMigrationBlockedResult> {
    const output = await new Deno.Command("git", {
        cwd: primaryCheckoutRoot,
        args: ["worktree", "list", "--porcelain"],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (output.code !== 0) {
        return block(
            "invalid_registered_checkout",
            [primaryCheckoutRoot],
            "Git could not list this project's worktrees.",
        );
    }
    const text = new TextDecoder().decode(output.stdout);
    const worktrees: GitWorktree[] = [];
    for (const record of text.trim().split("\n\n").filter(Boolean)) {
        const lines = record.split("\n");
        const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim() || "";
        const branch = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length).trim() || "";
        if (!path) continue;
        let realPath = path;
        try {
            realPath = await Deno.realPath(path);
        } catch {
            // A missing worktree is not usable evidence.
        }
        worktrees.push({ path, realPath, branch });
    }
    return { worktrees };
}

async function resolveSelectedRoots(
    requestedRoot: string,
    entries: LegacyRegistryEntry[],
    gitWorktrees: GitWorktree[],
    journalSelectedRoots: string[] = [],
): Promise<{ roots: string[] } | ProjectRuntimeMigrationBlockedResult> {
    const requested = await canonicalExistingRoot(requestedRoot);
    const byRealPath = new Set(gitWorktrees.map((worktree) => worktree.realPath));
    if (!byRealPath.has(requested)) {
        return block(
            "invalid_registered_checkout",
            [requestedRoot],
            "The selected checkout is not an attached Git worktree.",
        );
    }
    const roots = new Set<string>([requested]);
    for (const root of journalSelectedRoots) {
        const canonicalRoot = await canonicalExistingRoot(root);
        if (!byRealPath.has(canonicalRoot)) {
            return block(
                "invalid_registered_checkout",
                [root],
                "The migration journal names a checkout that is not an attached Git worktree.",
            );
        }
        roots.add(canonicalRoot);
    }
    for (const entry of entries) {
        if (typeof entry.path !== "string" || !entry.path) continue;
        let stat: Deno.FileInfo;
        try {
            stat = await Deno.lstat(entry.path);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound && entry.status === "abandoned") continue;
            return block(
                "invalid_registered_checkout",
                [entry.path],
                "A live registry entry names a missing checkout.",
            );
        }
        if (stat.isSymlink) {
            return block("symlink", [entry.path], "A registry entry names a symlinked checkout.");
        }
        if (!stat.isDirectory) {
            return block(
                "invalid_registered_checkout",
                [entry.path],
                "A registry entry names a non-directory checkout.",
            );
        }
        const realPath = await Deno.realPath(entry.path);
        if (!byRealPath.has(realPath)) {
            return block(
                "invalid_registered_checkout",
                [entry.path],
                "A registry entry names a directory that is not an attached Git worktree.",
            );
        }
        roots.add(realPath);
    }
    return { roots: [...roots].sort() };
}

async function inspectPublicationSafety(
    primaryCheckoutRoot: string,
    entries: LegacyRegistryEntry[],
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    const cleanedAttemptIds = new Set<string>();
    for (const entry of entries) {
        if (!entry.publication) continue;
        try {
            assertPublicationAttempt(entry.publication);
        } catch (error) {
            return block(
                "malformed_registry",
                [legacyWorktreeRegistryPath(primaryCheckoutRoot)],
                error instanceof Error ? error.message : String(error),
            );
        }
        if (entry.publication.failure?.repairRoot) {
            return block(
                "saved_repair_root",
                [entry.publication.failure.repairRoot],
                "A publication repair root exists. Finish or cancel publication before migration.",
            );
        }
        if (!isPublicationAttemptCleanupComplete(entry.publication)) {
            return block(
                "unfinished_publication",
                [legacyWorktreeRegistryPath(primaryCheckoutRoot)],
                "A publication has not reached cleanup_complete.",
            );
        }
        cleanedAttemptIds.add(entry.publication.attemptId);
    }
    const stagingRoot = join(legacyRuntimeBase(primaryCheckoutRoot), PLAN_STAGING_DIR_NAME);
    const entriesInStaging = await safeReadDir(stagingRoot);
    if (!entriesInStaging || entriesInStaging.length === 0) return undefined;
    return block(
        "unfinished_publication",
        entriesInStaging.map((entry) => join(stagingRoot, entry.name)).sort(),
        "A legacy publication staging directory is not empty. Finish or cancel publication before migration.",
    );
}

async function findTrackedRuntimePaths(
    primaryCheckoutRoot: string,
    selectedRoots: string[],
): Promise<{ runtimePaths: string[]; secretPaths: string[] } | ProjectRuntimeMigrationBlockedResult> {
    const runtimePaths = new Set<string>();
    const secretPaths = new Set<string>();
    for (const root of new Set([primaryCheckoutRoot, ...selectedRoots])) {
        const output = await new Deno.Command("git", {
            cwd: root,
            args: ["ls-files", "-z", "--", ...runtimeGitPathspecs()],
            stdout: "piped",
            stderr: "null",
        }).output();
        if (output.code !== 0) {
            return block(
                "invalid_registered_checkout",
                [root],
                "Git could not inspect tracked runtime paths for this checkout.",
            );
        }
        const paths = new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
        for (const path of paths) {
            const absolutePath = join(root, path);
            if (isProjectSecretGitPath(path)) secretPaths.add(absolutePath);
            else runtimePaths.add(absolutePath);
        }
    }
    return { runtimePaths: [...runtimePaths].sort(), secretPaths: [...secretPaths].sort() };
}

function runtimeGitPathspecs(): string[] {
    const legacy = LEGACY_PROJECT_RUNTIME_HAZARD_PATHS.map((path) => path.replace(/^\.\//, ""));
    return [join(RUNWIELD_DIR_NAME, PROJECT_INTERNAL_RUNTIME_DIR_NAME), ...legacy];
}

function isProjectSecretGitPath(path: string): boolean {
    return path === PROJECT_SECRET_STORE_RELATIVE_PATH ||
        (path.startsWith(`${PROJECT_SECRET_STORE_RELATIVE_PATH}.`) && path.endsWith(".tmp"));
}

async function findSymlinkBlocker(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    selectedRoots: string[] = [layout.selected.checkoutRoot],
): Promise<string[]> {
    const authorityRoots = [
        layout.primary.internalRoot,
        ...legacyPrimaryAuthorities(primaryCheckoutRoot).map((entry) => entry.source),
        ...selectedRoots.flatMap((root) => [
            internalRootFor(root),
            ...legacySelectedAuthorities(root).map((entry) => entry.source),
            legacyRelativePath(root, "work-record-supersession.lock"),
            legacyRelativePath(root, "work-record-supersession-recovery.lock"),
        ]),
    ];
    const symlinks: string[] = [];
    for (const root of [legacyRuntimeBase(primaryCheckoutRoot), ...selectedRoots.map(legacyRuntimeBase)]) {
        await collectOnlyThisSymlink(root, symlinks);
    }
    for (const root of authorityRoots) {
        await collectSymlinks(root, symlinks);
    }
    return symlinks;
}

async function collectOnlyThisSymlink(path: string, symlinks: string[]): Promise<void> {
    const info = await lstatOrNull(path);
    if (info?.isSymlink) symlinks.push(path);
}

async function collectSymlinks(path: string, symlinks: string[]): Promise<void> {
    let info: Deno.FileInfo;
    try {
        info = await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        throw error;
    }
    if (info.isSymlink) {
        symlinks.push(path);
        return;
    }
    if (!info.isDirectory) return;
    for await (const entry of Deno.readDir(path)) {
        await collectSymlinks(join(path, entry.name), symlinks);
    }
}

async function collectSpecialFiles(path: string, kind: PathKind, specialFiles: string[]): Promise<void> {
    const info = await lstatOrNull(path);
    if (!info) return;
    if (kind === "file") {
        if (!info.isFile) specialFiles.push(path);
        return;
    }
    if (!info.isDirectory) {
        specialFiles.push(path);
        return;
    }
    for await (const entry of Deno.readDir(path)) {
        const child = join(path, entry.name);
        const childInfo = await lstatOrNull(child);
        if (!childInfo) continue;
        if (childInfo.isDirectory) await collectSpecialFiles(child, "directory", specialFiles);
        else if (!childInfo.isFile && !childInfo.isSymlink) specialFiles.push(child);
    }
}

async function findCurrentAuthorityConflicts(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    selectedRoots: string[],
    marker: LayoutMarker | null,
    journal: MigrationJournal | null,
): Promise<string[]> {
    const allowedPrimary = new Set([
        basename(layout.primary.layoutMarkerPath),
        basename(layout.primary.layoutMigrationJournalPath),
        basename(layout.primary.layoutMigrationLockPath),
    ]);
    const conflicts: string[] = [];
    const allowedJournalPaths = new Set(
        (journal?.operations || [])
            .filter((operation) => operation.action === "rename")
            .map((operation) => (operation as MigrationRenameOperation).destination),
    );
    if (!marker) {
        conflicts.push(
            ...await currentConflictsInRoot(internalRootFor(primaryCheckoutRoot), allowedPrimary, allowedJournalPaths),
        );
    }
    const adoptedRoots = new Set(marker?.adoptedSelectedCheckoutRoots || []);
    for (const root of selectedRoots) {
        if (marker && (root === primaryCheckoutRoot || adoptedRoots.has(root))) continue;
        const selectedInternalRoot = internalRootFor(root);
        const allow = root === primaryCheckoutRoot ? allowedPrimary : new Set<string>();
        conflicts.push(...await currentConflictsInRoot(selectedInternalRoot, allow, allowedJournalPaths));
    }
    if (marker) {
        const primaryLegacy = await existingLegacyPaths(legacyPrimaryAuthorities(primaryCheckoutRoot));
        conflicts.push(...primaryLegacy.map((entry) => entry.path));
        for (const selectedRoot of marker.adoptedSelectedCheckoutRoots) {
            const selectedLegacy = await existingLegacyPaths(legacySelectedAuthorities(selectedRoot));
            conflicts.push(...selectedLegacy.map((entry) => entry.path));
        }
    }
    return [...new Set(conflicts)].sort();
}

async function currentConflictsInRoot(
    internalRoot: string,
    allowedRootNames: Set<string>,
    allowedPaths: Set<string>,
): Promise<string[]> {
    const info = await lstatOrNull(internalRoot);
    if (!info) return [];
    if (!info.isDirectory) return [internalRoot];
    const entries = await safeReadDir(internalRoot);
    if (!entries) return [];
    const conflicts: string[] = [];
    for (const entry of entries) {
        if (allowedRootNames.has(entry.name)) continue;
        const path = join(internalRoot, entry.name);
        if (allowedPaths.has(path)) continue;
        if (await isEmptyDirectory(path)) continue;
        conflicts.push(path);
    }
    return conflicts;
}

async function inspectLegacyLocks(
    primaryCheckoutRoot: string,
    selectedRoots: string[],
    options: { legacyRegistryLockHeld?: boolean } = {},
): Promise<LegacyLockStatus> {
    const active: string[] = [];
    const retire: MigrationRetireOperation[] = [];
    const registryLock = legacyWorktreeRegistryLockPath(primaryCheckoutRoot);
    if (!options.legacyRegistryLockHeld) {
        const registryStatus = await classifyProcessLock(registryLock, 30_000);
        if (registryStatus.status === "active") active.push(registryLock);
        if (registryStatus.status === "stale") retire.push(retireLockOperation(registryLock, registryStatus.snapshot));
    }

    for (const root of selectedRoots) {
        const selectedBase = legacyRuntimeBase(root);
        const planLocks = await listFiles(join(selectedBase, PLAN_LOCKS_DIR_NAME));
        for (const lockPath of planLocks.filter((path) => path.endsWith(".lock"))) {
            const status = await classifyPlanLock(lockPath);
            if (status.status === "active") active.push(lockPath);
            if (status.status === "stale") retire.push(retireLockOperation(lockPath, status.snapshot));
        }
        for (
            const lock of [
                { path: join(selectedBase, "work-record-supersession.lock"), staleMs: WORK_RECORD_LOCK_STALE_MS },
                {
                    path: join(selectedBase, "work-record-supersession-recovery.lock"),
                    staleMs: WORK_RECORD_RECOVERY_LOCK_STALE_MS,
                },
            ]
        ) {
            const status = await classifyWorkRecordLock(lock.path, lock.staleMs);
            if (status.status === "active") active.push(lock.path);
            if (status.status === "stale") retire.push(retireLockOperation(lock.path, status.snapshot));
        }
    }

    for (const lockPath of await listFiles(join(legacyRuntimeBase(primaryCheckoutRoot), "controller"))) {
        if (!lockPath.endsWith(".lock")) continue;
        if (!(await canTakeControllerLock(lockPath))) active.push(lockPath);
    }
    return { active, retire };
}

type LegacyLockClassification =
    | { status: "absent" }
    | { status: "active"; snapshot: LockSnapshot }
    | { status: "stale"; snapshot: LockSnapshot };

async function classifyProcessLock(path: string, staleMs: number): Promise<LegacyLockClassification> {
    const snapshot = await readLockFileSnapshot(path);
    if (!snapshot) return { status: "absent" };
    if (await isLockHolderGone(snapshot.text)) return { status: "stale", snapshot };
    const parsed = parseJsonDocument(snapshot.text);
    const createdAtMs = typeof parsed?.createdAtMs === "number" ? parsed.createdAtMs : 0;
    const updatedAtMs = typeof parsed?.updatedAtMs === "number" ? parsed.updatedAtMs : createdAtMs;
    const ageAnchor = updatedAtMs || snapshot.mtime;
    return Date.now() - ageAnchor > staleMs ? { status: "stale", snapshot } : { status: "active", snapshot };
}

async function classifyPlanLock(path: string): Promise<LegacyLockClassification> {
    const snapshot = await readLockFileSnapshot(path);
    if (!snapshot) return { status: "absent" };
    if (await isLockHolderGone(snapshot.text)) return { status: "stale", snapshot };
    return Date.now() - snapshot.mtime > PLAN_LOCK_STALE_MS
        ? { status: "stale", snapshot }
        : { status: "active", snapshot };
}

async function classifyWorkRecordLock(path: string, staleMs: number): Promise<LegacyLockClassification> {
    const snapshot = await readLockFileSnapshot(path);
    if (!snapshot) return { status: "absent" };
    const updatedAt = snapshot.updatedAt ?? snapshot.mtime;
    return Date.now() - updatedAt > staleMs ? { status: "stale", snapshot } : { status: "active", snapshot };
}

function parseJsonDocument(text: string) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function retireLockOperation(source: string, proof: LockSnapshot): MigrationRetireOperation {
    return { action: "retire", source, kind: "file", proof, completed: false };
}

async function canTakeControllerLock(path: string): Promise<boolean> {
    const file = await Deno.open(path, { read: true, write: true });
    try {
        if (!file.tryLockSync(true)) return false;
        file.unlockSync();
        return true;
    } finally {
        file.close();
    }
}

async function validateLegacyAuthorities(
    primaryCheckoutRoot: string,
    selectedRoots: string[],
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    const secretTemp = await listSiblingTemps(legacyRelativePath(primaryCheckoutRoot, "collaboration-secrets.json"));
    if (secretTemp.length > 0) {
        return block("malformed_migration_evidence", secretTemp, "A legacy secret temp file is present.");
    }
    const registryTemp = await listSiblingTemps(legacyWorktreeRegistryPath(primaryCheckoutRoot));
    if (registryTemp.length > 0) {
        return block("malformed_migration_evidence", registryTemp, "A legacy registry temp file is present.");
    }

    const specialFiles: string[] = [];
    const symlinks: string[] = [];
    for (
        const authority of [
            ...legacyPrimaryAuthorities(primaryCheckoutRoot),
            ...selectedRoots.flatMap(legacySelectedAuthorities),
        ]
    ) {
        await collectSymlinks(authority.source, symlinks);
        await collectSpecialFiles(authority.source, authority.kind, specialFiles);
    }
    if (symlinks.length > 0) return block("symlink", symlinks, "A legacy runtime authority uses a symlink.");
    if (specialFiles.length > 0) {
        return block(
            "malformed_migration_evidence",
            specialFiles,
            "A legacy runtime path has the wrong filesystem type.",
        );
    }
    return undefined;
}

async function buildOperations(
    primaryCheckoutRoot: string,
    selectedRoots: string[],
    staleLocks: MigrationRetireOperation[],
    marker: LayoutMarker | null,
): Promise<MigrationOperation[]> {
    const operations: MigrationOperation[] = [];
    operations.push(...staleLocks);
    const primaryAuthorities = legacyPrimaryAuthorities(primaryCheckoutRoot);
    const registryAuthorities = primaryAuthorities.filter((authority) =>
        basename(authority.source) === WORKTREE_REGISTRY_FILE ||
        basename(authority.source) === "worktree-registry-migration-issues.json"
    );
    if (!marker) {
        for (const authority of primaryAuthorities.filter((authority) => !registryAuthorities.includes(authority))) {
            if (await lstatOrNull(authority.source)) {
                operations.push({ ...authority, action: "rename", completed: false });
            }
        }
    }
    const adopted = new Set(marker?.adoptedSelectedCheckoutRoots || []);
    for (const selectedRoot of selectedRoots) {
        if (adopted.has(selectedRoot)) continue;
        for (const authority of legacySelectedAuthorities(selectedRoot)) {
            if (await lstatOrNull(authority.source)) {
                operations.push({ ...authority, action: "rename", completed: false });
            }
        }
    }
    if (!marker) {
        for (const authority of registryAuthorities) {
            if (await lstatOrNull(authority.source)) {
                operations.push({ ...authority, action: "rename", completed: false });
            }
        }
    }
    return operations;
}

function legacyPrimaryAuthorities(primaryCheckoutRoot: string): MigrationRenameOperation[] {
    const base = legacyRuntimeBase(primaryCheckoutRoot);
    const internal = internalRootFor(primaryCheckoutRoot);
    return [
        {
            action: "rename",
            source: join(base, "controller"),
            destination: join(internal, "controller"),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, WORKTREE_REGISTRY_FILE),
            destination: join(internal, WORKTREE_REGISTRY_FILE),
            kind: "file",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, "worktree-registry-migration-issues.json"),
            destination: join(internal, "worktree-registry-migration-issues.json"),
            kind: "file",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, PLAN_STAGING_DIR_NAME),
            destination: join(internal, PLAN_STAGING_DIR_NAME),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, "worktrees"),
            destination: join(internal, "worktrees"),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, "debug"),
            destination: join(internal, "debug"),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, basename(PROJECT_SECRET_STORE_RELATIVE_PATH)),
            destination: join(internal, "collaboration-secrets.json"),
            kind: "file",
            completed: false,
        },
    ];
}

function legacySelectedAuthorities(selectedRoot: string): MigrationRenameOperation[] {
    const base = legacyRuntimeBase(selectedRoot);
    const internal = internalRootFor(selectedRoot);
    return [
        {
            action: "rename",
            source: join(base, PLAN_TRANSITIONS_DIR_NAME),
            destination: join(internal, PLAN_TRANSITIONS_DIR_NAME),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, PLAN_BACKUPS_DIR_NAME),
            destination: join(internal, PLAN_BACKUPS_DIR_NAME),
            kind: "directory",
            completed: false,
        },
        {
            action: "rename",
            source: join(base, PLAN_LOCKS_DIR_NAME),
            destination: join(internal, PLAN_LOCKS_DIR_NAME),
            kind: "directory",
            completed: false,
        },
    ];
}

async function readOrCreateJournal(
    layout: ProjectRuntimeLayout,
    preflightResult: MigrationPreflight,
): Promise<{ journal: MigrationJournal } | ProjectRuntimeMigrationBlockedResult> {
    const existing = await readJournal(layout.primary.layoutMigrationJournalPath);
    if (isBlocked(existing)) return existing;
    if (existing.journal) {
        if (
            existing.journal.primaryCheckoutRoot !== preflightResult.primaryCheckoutRoot ||
            !(await journalOperationsAllowed(preflightResult, existing.journal.operations)) ||
            !journalContainsRequiredOperations(existing.journal, preflightResult)
        ) {
            return block(
                "malformed_migration_evidence",
                [layout.primary.layoutMigrationJournalPath],
                "The runtime migration journal does not match current verified paths.",
            );
        }
        return { journal: existing.journal };
    }
    const journal: MigrationJournal = {
        version: LAYOUT_VERSION,
        primaryCheckoutRoot: preflightResult.primaryCheckoutRoot,
        selectedCheckoutRoots: preflightResult.selectedCheckoutRoots,
        operations: preflightResult.operations,
        updatedAt: new Date().toISOString(),
    };
    await writeJournal(layout.primary.layoutMigrationJournalPath, journal);
    return { journal };
}

async function readJournal(
    path: string,
): Promise<{ journal: MigrationJournal | null } | ProjectRuntimeMigrationBlockedResult> {
    try {
        const parsed = JSON.parse(await Deno.readTextFile(path));
        if (
            !parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== LAYOUT_VERSION ||
            typeof parsed.primaryCheckoutRoot !== "string" || !Array.isArray(parsed.selectedCheckoutRoots) ||
            !parsed.selectedCheckoutRoots.every((root: string) => typeof root === "string") ||
            !Array.isArray(parsed.operations) || !parsed.operations.every(isMigrationOperation)
        ) {
            return block("malformed_migration_evidence", [path], "The runtime migration journal is malformed.");
        }
        return { journal: parsed as MigrationJournal };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { journal: null };
        if (error instanceof SyntaxError) {
            return block("malformed_migration_evidence", [path], "The runtime migration journal is not valid JSON.");
        }
        throw error;
    }
}

function isMigrationOperation(value: MigrationOperation): boolean {
    if (!value || typeof value !== "object") return false;
    if (value.action === "rename") {
        return typeof value.source === "string" && typeof value.destination === "string" &&
            (value.kind === "file" || value.kind === "directory") && typeof value.completed === "boolean";
    }
    if (value.action === "retire") {
        return typeof value.source === "string" && value.kind === "file" && typeof value.completed === "boolean" &&
            Boolean(value.proof) && typeof value.proof.text === "string" &&
            typeof value.proof.mtime === "number" && typeof value.proof.size === "number" &&
            (value.proof.token === undefined || typeof value.proof.token === "string") &&
            (value.proof.createdAt === undefined || typeof value.proof.createdAt === "number") &&
            (value.proof.updatedAt === undefined || typeof value.proof.updatedAt === "number");
    }
    return false;
}

async function journalOperationsAllowed(
    preflightResult: MigrationPreflight,
    operations: MigrationOperation[],
): Promise<boolean> {
    for (const operation of operations) {
        if (!(await isAllowedJournalOperation(preflightResult, operation))) return false;
    }
    return true;
}

async function isAllowedJournalOperation(
    preflightResult: MigrationPreflight,
    operation: MigrationOperation,
): Promise<boolean> {
    const allowed = new Set(preflightResult.operations.map(operationKey));
    if (allowed.has(operationKey(operation))) return true;
    if (operation.action === "retire") {
        return isBoundedLegacyLockPath(preflightResult, operation.source) &&
            (operation.completed || !(await lstatOrNull(operation.source)));
    }
    const authorities = [
        ...legacyPrimaryAuthorities(preflightResult.primaryCheckoutRoot),
        ...preflightResult.selectedCheckoutRoots.flatMap(legacySelectedAuthorities),
    ];
    return authorities.some((authority) =>
        authority.source === operation.source && authority.destination === operation.destination &&
        authority.kind === operation.kind
    );
}

function isBoundedLegacyLockPath(preflightResult: MigrationPreflight, path: string): boolean {
    if (path !== resolve(path)) return false;
    if (path === legacyWorktreeRegistryLockPath(preflightResult.primaryCheckoutRoot)) return true;
    return preflightResult.selectedCheckoutRoots.some((root) => {
        const base = legacyRuntimeBase(root);
        const planLocksDir = join(base, PLAN_LOCKS_DIR_NAME);
        return path === join(base, "work-record-supersession.lock") ||
            path === join(base, "work-record-supersession-recovery.lock") ||
            (path.startsWith(`${planLocksDir}/`) && path.endsWith(".lock"));
    });
}

function journalContainsRequiredOperations(journal: MigrationJournal, preflightResult: MigrationPreflight): boolean {
    const journalOperations = new Set(journal.operations.map(operationKey));
    return preflightResult.operations.every((operation) => journalOperations.has(operationKey(operation)));
}

function operationKey(operation: MigrationOperation): string {
    return JSON.stringify({ ...operation, completed: false });
}

async function replayJournal(
    layout: ProjectRuntimeLayout,
    journal: MigrationJournal,
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    for (const operation of journal.operations) {
        if (operation.action === "rename") {
            const result = await applyRenameOperation(layout, journal, operation);
            if (isBlocked(result)) return result;
        } else {
            const result = await applyRetireOperation(layout, journal, operation);
            if (isBlocked(result)) return result;
        }
    }
    return undefined;
}

async function applyRenameOperation(
    layout: ProjectRuntimeLayout,
    journal: MigrationJournal,
    operation: MigrationRenameOperation,
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    const source = await lstatOrNull(operation.source);
    const destination = await lstatOrNull(operation.destination);
    if (source && !destination) {
        await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, false));
        await Deno.mkdir(dirname(operation.destination), { recursive: true, mode: 0o700 });
        try {
            await Deno.rename(operation.source, operation.destination);
        } catch (error) {
            if (error instanceof Error && isCrossDeviceError(error)) {
                return block(
                    "unsupported_filesystem_move",
                    [operation.source, operation.destination],
                    "The runtime state cannot be moved atomically on this filesystem.",
                );
            }
            throw error;
        }
        await syncDirectory(dirname(operation.source));
        await syncDirectory(dirname(operation.destination));
        await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
        operation.completed = true;
        return undefined;
    }
    if (!source && destination) {
        operation.completed = true;
        await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
        return undefined;
    }
    if (!source && !destination) {
        return block(
            "malformed_migration_evidence",
            [operation.source, operation.destination],
            "A journaled runtime rename lost both source and destination.",
        );
    }
    if (source && destination && await isEmptyDirectory(operation.destination)) {
        await Deno.remove(operation.destination);
        await syncDirectory(dirname(operation.destination));
        try {
            await Deno.rename(operation.source, operation.destination);
        } catch (error) {
            if (error instanceof Error && isCrossDeviceError(error)) {
                return block(
                    "unsupported_filesystem_move",
                    [operation.source, operation.destination],
                    "The runtime state cannot be moved atomically on this filesystem.",
                );
            }
            throw error;
        }
        await syncDirectory(dirname(operation.source));
        await syncDirectory(dirname(operation.destination));
        operation.completed = true;
        await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
        return undefined;
    }
    return block(
        "authority_conflict",
        [operation.source, operation.destination],
        "Both legacy and internal runtime authorities exist.",
    );
}

async function applyRetireOperation(
    layout: ProjectRuntimeLayout,
    journal: MigrationJournal,
    operation: MigrationRetireOperation,
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, false));
    const recoveryLockPath = workRecordRecoveryLockPathForRetire(journal, operation.source);
    if (recoveryLockPath) {
        const releaseRecovery = await acquireLegacyWorkRecordRecoveryLock(recoveryLockPath);
        try {
            return await retireLockIfUnchanged(layout, journal, operation);
        } finally {
            await releaseRecovery();
        }
    }
    return await retireLockIfUnchanged(layout, journal, operation);
}

async function retireLockIfUnchanged(
    layout: ProjectRuntimeLayout,
    journal: MigrationJournal,
    operation: MigrationRetireOperation,
): Promise<undefined | ProjectRuntimeMigrationBlockedResult> {
    const current = await readLockFileSnapshot(operation.source);
    if (!current) {
        operation.completed = true;
        await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
        return undefined;
    }
    if (!lockFileSnapshotMatches(current, operation.proof)) {
        return block(
            "active_legacy_writer",
            [operation.source],
            "A legacy lock changed after migration preflight. Migration stopped before retiring it.",
        );
    }
    if (!(await removeLockFileIfSnapshotMatches(operation.source, operation.proof))) {
        return block(
            "active_legacy_writer",
            [operation.source],
            "A legacy lock changed after migration preflight. Migration stopped before retiring it.",
        );
    }
    await syncDirectory(dirname(operation.source));
    operation.completed = true;
    await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
    return undefined;
}

function workRecordRecoveryLockPathForRetire(journal: MigrationJournal, lockPath: string): string | null {
    for (const root of journal.selectedCheckoutRoots) {
        const base = legacyRuntimeBase(root);
        if (lockPath === join(base, "work-record-supersession.lock")) {
            return join(base, "work-record-supersession-recovery.lock");
        }
    }
    return null;
}

async function acquireLegacyWorkRecordRecoveryLock(lockPath: string): Promise<() => Promise<void>> {
    await Deno.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const token = crypto.randomUUID();
    const deadline = Date.now() + WORK_RECORD_LOCK_WAIT_TIMEOUT_MS;
    while (true) {
        try {
            const file = await createWorkRecordLockFile(lockPath, token);
            const heartbeat = setInterval(() => {
                updateWorkRecordLockFile(file, lockPath, token).catch(() => {});
            }, WORK_RECORD_LOCK_HEARTBEAT_MS);
            Deno.unrefTimer(heartbeat);
            return async () => {
                clearInterval(heartbeat);
                file.close();
                await removeWorkRecordLockIfOwned(lockPath, token);
            };
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            const status = await classifyWorkRecordLock(lockPath, WORK_RECORD_RECOVERY_LOCK_STALE_MS);
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for the Work Record supersession recovery lock: ${lockPath}`);
            }
            if (
                status.status === "stale" &&
                await removeLockFileIfSnapshotMatches(lockPath, status.snapshot)
            ) {
                continue;
            }
            await new Promise((resolveTimer) => setTimeout(resolveTimer, WORK_RECORD_LOCK_RETRY_MS));
        }
    }
}

async function createWorkRecordLockFile(lockPath: string, token: string): Promise<Deno.FsFile> {
    const file = await Deno.open(lockPath, { createNew: true, read: true, write: true, mode: 0o600 });
    try {
        file.lockSync(true);
        const now = Date.now();
        await writeWorkRecordLockFile(file, { token, createdAt: now, updatedAt: now });
        return file;
    } catch (error) {
        file.close();
        throw error;
    }
}

async function updateWorkRecordLockFile(file: Deno.FsFile, lockPath: string, token: string): Promise<void> {
    const parsed = parseJsonDocument(await Deno.readTextFile(lockPath));
    if (parsed?.token !== token || typeof parsed.createdAt !== "number") return;
    await writeWorkRecordLockFile(file, { token, createdAt: parsed.createdAt, updatedAt: Date.now() });
}

async function writeWorkRecordLockFile(file: Deno.FsFile, record: WorkRecordLockDocument): Promise<void> {
    await file.truncate(0);
    await file.seek(0, Deno.SeekMode.Start);
    await file.write(new TextEncoder().encode(JSON.stringify(record)));
    await file.sync();
}

async function removeWorkRecordLockIfOwned(lockPath: string, token: string): Promise<void> {
    const current = await readLockFileSnapshot(lockPath);
    if (current?.token !== token) return;
    await removeLockFileIfSnapshotMatches(lockPath, current);
}

function markOperation(journal: MigrationJournal, source: string, completed: boolean): MigrationJournal {
    return {
        ...journal,
        operations: journal.operations.map((operation) =>
            operation.source === source ? { ...operation, completed } : operation
        ),
        updatedAt: new Date().toISOString(),
    };
}

async function writeJournal(path: string, journal: MigrationJournal): Promise<void> {
    await atomicWriteJson(path, journal);
}

async function writeLayoutMarker(path: string, marker: LayoutMarker): Promise<void> {
    await atomicWriteJson(path, marker);
}

async function atomicWriteJson(path: string, value: MigrationJournal | LayoutMarker): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await Deno.chmod(dirname(path), 0o700).catch(() => {});
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    try {
        const file = await Deno.open(temporary, { createNew: true, write: true, mode: 0o600 });
        try {
            await file.write(new TextEncoder().encode(payload));
            await file.sync();
        } finally {
            file.close();
        }
        await Deno.rename(temporary, path);
        await syncDirectory(dirname(path));
    } finally {
        await Deno.remove(temporary).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
    }
}

async function acquireMigrationLock(lockPath: string): Promise<{ release: () => Promise<void> }> {
    await Deno.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    await Deno.chmod(dirname(lockPath), 0o700).catch(() => {});
    const token = crypto.randomUUID();
    while (true) {
        try {
            const file = await createMigrationLockFile(lockPath, token);
            const heartbeat = setInterval(() => {
                updateMigrationLockFile(lockPath, token).catch(() => {});
            }, MIGRATION_LOCK_HEARTBEAT_MS);
            Deno.unrefTimer(heartbeat);
            return {
                release: async () => {
                    clearInterval(heartbeat);
                    try {
                        await removeMigrationLockIfOwned(lockPath, token);
                    } finally {
                        file.close();
                    }
                },
            };
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            const status = await classifyProcessLock(lockPath, MIGRATION_LOCK_STALE_MS);
            if (status.status === "stale") {
                await removeLockFileIfSnapshotMatches(lockPath, status.snapshot);
                continue;
            }
            await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
        }
    }
}

async function createMigrationLockFile(lockPath: string, token: string): Promise<Deno.FsFile> {
    const file = await Deno.open(lockPath, { createNew: true, read: true, write: true, mode: 0o600 });
    try {
        file.lockSync(true);
        await file.write(
            new TextEncoder().encode(
                JSON.stringify({
                    token,
                    pid: Deno.pid,
                    hostname: getLockHostname(),
                    createdAtMs: Date.now(),
                    updatedAtMs: Date.now(),
                }),
            ),
        );
        await file.sync();
        return file;
    } catch (error) {
        file.close();
        throw error;
    }
}

async function updateMigrationLockFile(lockPath: string, token: string): Promise<void> {
    const parsed = JSON.parse(await Deno.readTextFile(lockPath));
    if (parsed.token !== token) return;
    await Deno.writeTextFile(lockPath, JSON.stringify({ ...parsed, updatedAtMs: Date.now() }));
}

async function removeMigrationLockIfOwned(lockPath: string, token: string): Promise<void> {
    try {
        const parsed = JSON.parse(await Deno.readTextFile(lockPath));
        if (parsed.token !== token) return;
        await Deno.remove(lockPath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

function mergedSelectedRoots(marker: LayoutMarker | null, selectedRoots: string[]): string[] {
    return [...new Set([...(marker?.adoptedSelectedCheckoutRoots || []), ...selectedRoots])].sort();
}

async function existingLegacyPaths(authorities: MigrationRenameOperation[]): Promise<ExistingEntry[]> {
    const existing: ExistingEntry[] = [];
    for (const authority of authorities) {
        const info = await lstatOrNull(authority.source);
        if (info) existing.push({ path: authority.source, info });
    }
    return existing;
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
    try {
        return await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

async function safeReadDir(path: string): Promise<Deno.DirEntry[] | null> {
    try {
        const entries: Deno.DirEntry[] = [];
        for await (const entry of Deno.readDir(path)) entries.push(entry);
        return entries;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

async function listFiles(path: string): Promise<string[]> {
    const info = await lstatOrNull(path);
    if (!info || !info.isDirectory) return [];
    const files: string[] = [];
    for await (const entry of Deno.readDir(path)) {
        const child = join(path, entry.name);
        if (entry.isDirectory) files.push(...await listFiles(child));
        else files.push(child);
    }
    return files;
}

async function isEmptyDirectory(path: string): Promise<boolean> {
    const info = await lstatOrNull(path);
    if (!info) return true;
    if (!info.isDirectory) return false;
    for await (const _entry of Deno.readDir(path)) return false;
    return true;
}

async function removeEmptyDirectory(path: string): Promise<void> {
    if (!(await isEmptyDirectory(path))) return;
    await Deno.remove(path).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

async function listSiblingTemps(path: string): Promise<string[]> {
    const directory = dirname(path);
    const prefix = `${basename(path)}.`;
    const entries = await safeReadDir(directory);
    if (!entries) return [];
    return entries
        .filter((entry) => entry.name.startsWith(prefix) && entry.name.endsWith(".tmp"))
        .map((entry) => join(directory, entry.name));
}

async function syncDirectory(path: string): Promise<void> {
    const directory = await Deno.open(path, { read: true });
    try {
        await directory.sync();
    } finally {
        directory.close();
    }
}

function isCrossDeviceError(error: Error): boolean {
    return "code" in error && String(error.code) === "EXDEV";
}
