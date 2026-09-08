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

type MigrationRetireOperation = {
    action: "retire";
    source: string;
    kind: PathKind;
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
    retire: string[];
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
    const marker = await readLayoutMarker(layout);
    if (isBlocked(marker)) return marker;

    const beforeLock = await preflight(layout, primaryCheckoutRoot, marker.marker);
    if (isBlocked(beforeLock)) return beforeLock;
    const unchanged = completeMarkerNeedsNoWork(marker.marker, beforeLock);
    if (unchanged && marker.marker) {
        return {
            kind: "ready",
            layout,
            migrated: false,
            adoptedSelectedCheckoutRoots: marker.marker.adoptedSelectedCheckoutRoots,
        };
    }

    const lock = await acquireMigrationLock(layout.primary.layoutMigrationLockPath);
    try {
        return await withWorktreeRegistryLockAtPath(legacyWorktreeRegistryLockPath(primaryCheckoutRoot), async () => {
            const locked = await preflight(layout, primaryCheckoutRoot, marker.marker, {
                legacyRegistryLockHeld: true,
            });
            if (isBlocked(locked)) return locked;
            const lockedUnchanged = completeMarkerNeedsNoWork(marker.marker, locked);
            if (lockedUnchanged && marker.marker) {
                return {
                    kind: "ready",
                    layout,
                    migrated: false,
                    adoptedSelectedCheckoutRoots: marker.marker.adoptedSelectedCheckoutRoots,
                };
            }
            const journal = await readOrCreateJournal(layout, locked);
            if (isBlocked(journal)) return journal;
            const replay = await replayJournal(layout, journal.journal);
            if (isBlocked(replay)) return replay;
            const adoptedSelectedCheckoutRoots = mergedSelectedRoots(marker.marker, locked.selectedCheckoutRoots);
            await writeLayoutMarker(layout.primary.layoutMarkerPath, {
                version: LAYOUT_VERSION,
                primaryCheckoutRoot,
                adoptedSelectedCheckoutRoots,
                completedAt: new Date().toISOString(),
            });
            await Deno.remove(layout.primary.layoutMigrationJournalPath).catch((error) => {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            });
            await Deno.remove(legacyWorktreeRegistryLockPath(primaryCheckoutRoot)).catch((error) => {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            });
            return { kind: "ready", layout, migrated: true, adoptedSelectedCheckoutRoots };
        });
    } finally {
        await lock.release();
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

function completeMarkerNeedsNoWork(marker: LayoutMarker | null, preflightResult: MigrationPreflight): boolean {
    return Boolean(
        marker && preflightResult.operations.length === 0 &&
            preflightResult.selectedCheckoutRoots.every((root) => marker.adoptedSelectedCheckoutRoots.includes(root)),
    );
}

async function preflight(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    marker: LayoutMarker | null,
    options: { legacyRegistryLockHeld?: boolean } = {},
): Promise<MigrationPreflight | ProjectRuntimeMigrationBlockedResult> {
    const markerCheck = validateMarkerRoots(layout, primaryCheckoutRoot, marker);
    if (isBlocked(markerCheck)) return markerCheck;

    const symlink = await findSymlinkBlocker(layout, primaryCheckoutRoot);
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
    );
    if (isBlocked(selectedRoots)) return selectedRoots;

    const tracked = await findTrackedRuntimePaths(primaryCheckoutRoot, selectedRoots.roots);
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

    const journalForConflicts = await readJournal(layout.primary.layoutMigrationJournalPath);
    if (isBlocked(journalForConflicts)) return journalForConflicts;
    const currentConflict = await findCurrentAuthorityConflicts(
        layout,
        primaryCheckoutRoot,
        selectedRoots.roots,
        marker,
        journalForConflicts.journal,
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

function validateMarkerRoots(
    layout: ProjectRuntimeLayout,
    primaryCheckoutRoot: string,
    marker: LayoutMarker | null,
): ProjectRuntimeMigrationBlockedResult | undefined {
    if (!marker) return undefined;
    if (marker.primaryCheckoutRoot !== primaryCheckoutRoot) {
        return block(
            "malformed_migration_evidence",
            [layout.primary.layoutMarkerPath],
            "The project runtime layout marker names a different primary checkout root.",
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
    if (!entriesInStaging) return undefined;
    for (const entry of entriesInStaging) {
        if (entry.name.startsWith(".")) continue;
        if (!cleanedAttemptIds.has(entry.name)) {
            return block(
                "unfinished_publication",
                [join(stagingRoot, entry.name)],
                "A legacy publication staging directory has no cleanup_complete publication record.",
            );
        }
    }
    return undefined;
}

async function findTrackedRuntimePaths(
    primaryCheckoutRoot: string,
    selectedRoots: string[],
): Promise<{ runtimePaths: string[]; secretPaths: string[] }> {
    const runtimePaths = new Set<string>();
    const secretPaths = new Set<string>();
    for (const root of new Set([primaryCheckoutRoot, ...selectedRoots])) {
        const output = await new Deno.Command("git", {
            cwd: root,
            args: ["ls-files", "-z", "--", ...runtimeGitPathspecs()],
            stdout: "piped",
            stderr: "null",
        }).output();
        if (output.code !== 0) continue;
        const paths = new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
        for (const path of paths) {
            const absolutePath = join(root, path);
            if (path === PROJECT_SECRET_STORE_RELATIVE_PATH) secretPaths.add(absolutePath);
            else runtimePaths.add(absolutePath);
        }
    }
    return { runtimePaths: [...runtimePaths].sort(), secretPaths: [...secretPaths].sort() };
}

function runtimeGitPathspecs(): string[] {
    const exact = LEGACY_PROJECT_RUNTIME_HAZARD_PATHS
        .filter((path) => !path.includes("*"))
        .map((path) => path.replace(/^\.\//, ""));
    return [join(RUNWIELD_DIR_NAME, PROJECT_INTERNAL_RUNTIME_DIR_NAME), ...exact];
}

async function findSymlinkBlocker(layout: ProjectRuntimeLayout, primaryCheckoutRoot: string): Promise<string[]> {
    const roots = [
        legacyRuntimeBase(primaryCheckoutRoot),
        layout.primary.internalRoot,
        ...legacyPrimaryAuthorities(primaryCheckoutRoot).map((entry) => entry.source),
        legacyRelativePath(layout.selected.checkoutRoot, PLAN_LOCKS_DIR_NAME),
        legacyRelativePath(layout.selected.checkoutRoot, PLAN_TRANSITIONS_DIR_NAME),
        legacyRelativePath(layout.selected.checkoutRoot, PLAN_BACKUPS_DIR_NAME),
        legacyRelativePath(layout.selected.checkoutRoot, "work-record-supersession.lock"),
        legacyRelativePath(layout.selected.checkoutRoot, "work-record-supersession-recovery.lock"),
    ];
    const symlinks: string[] = [];
    for (const root of roots) {
        await collectSymlinks(root, symlinks);
    }
    return symlinks;
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
    const retire: string[] = [];
    const registryLock = legacyWorktreeRegistryLockPath(primaryCheckoutRoot);
    if (!options.legacyRegistryLockHeld) {
        const registryStatus = await classifyProcessLock(registryLock, 30_000);
        if (registryStatus === "active") active.push(registryLock);
        if (registryStatus === "stale") retire.push(registryLock);
    }

    for (const root of selectedRoots) {
        const selectedBase = legacyRuntimeBase(root);
        const planLocks = await listFiles(join(selectedBase, PLAN_LOCKS_DIR_NAME));
        for (const lockPath of planLocks.filter((path) => path.endsWith(".lock"))) {
            const status = await classifyPlanLock(lockPath);
            if (status === "active") active.push(lockPath);
            if (status === "stale") retire.push(lockPath);
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
            if (status === "active") active.push(lock.path);
            if (status === "stale") retire.push(lock.path);
        }
    }

    for (const lockPath of await listFiles(join(legacyRuntimeBase(primaryCheckoutRoot), "controller"))) {
        if (!lockPath.endsWith(".lock")) continue;
        if (!(await canTakeControllerLock(lockPath))) active.push(lockPath);
    }
    return { active, retire };
}

async function classifyProcessLock(path: string, staleMs: number): Promise<"absent" | "active" | "stale"> {
    const snapshot = await readLockTextAndStat(path);
    if (!snapshot) return "absent";
    if (await isLockHolderGone(snapshot.text)) return "stale";
    const parsed = parseJsonDocument(snapshot.text);
    const createdAtMs = typeof parsed?.createdAtMs === "number" ? parsed.createdAtMs : 0;
    const updatedAtMs = typeof parsed?.updatedAtMs === "number" ? parsed.updatedAtMs : createdAtMs;
    const ageAnchor = updatedAtMs || snapshot.mtime;
    return Date.now() - ageAnchor > staleMs ? "stale" : "active";
}

async function classifyPlanLock(path: string): Promise<"absent" | "active" | "stale"> {
    const snapshot = await readLockTextAndStat(path);
    if (!snapshot) return "absent";
    if (await isLockHolderGone(snapshot.text)) return "stale";
    return Date.now() - snapshot.mtime > PLAN_LOCK_STALE_MS ? "stale" : "active";
}

async function classifyWorkRecordLock(path: string, staleMs: number): Promise<"absent" | "active" | "stale"> {
    const snapshot = await readLockTextAndStat(path);
    if (!snapshot) return "absent";
    const parsed = parseJsonDocument(snapshot.text);
    const updatedAt = typeof parsed?.updatedAt === "number" ? parsed.updatedAt : snapshot.mtime;
    return Date.now() - updatedAt > staleMs ? "stale" : "active";
}

async function readLockTextAndStat(path: string): Promise<{ text: string; mtime: number } | null> {
    try {
        const text = await Deno.readTextFile(path);
        const stat = await Deno.stat(path);
        return { text, mtime: stat.mtime?.getTime() ?? Date.now() };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

function parseJsonDocument(text: string) {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
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
        const info = await lstatOrNull(authority.source);
        if (!info) continue;
        if (authority.kind === "directory" && !info.isDirectory) specialFiles.push(authority.source);
        if (authority.kind === "file" && !info.isFile) specialFiles.push(authority.source);
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
    staleLocks: string[],
    marker: LayoutMarker | null,
): Promise<MigrationOperation[]> {
    const operations: MigrationOperation[] = [];
    if (!marker) {
        for (const authority of legacyPrimaryAuthorities(primaryCheckoutRoot)) {
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
    for (const source of staleLocks) {
        operations.push({ action: "retire", source, kind: "file", completed: false });
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
            !existing.journal.operations.every((operation) => isAllowedJournalOperation(preflightResult, operation))
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
            !Array.isArray(parsed.operations)
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

function isAllowedJournalOperation(preflightResult: MigrationPreflight, operation: MigrationOperation): boolean {
    const allowed = new Set(
        preflightResult.operations.map((candidate) => JSON.stringify({ ...candidate, completed: false })),
    );
    const normalized = JSON.stringify({ ...operation, completed: false });
    if (allowed.has(normalized)) return true;
    if (operation.action === "retire") return operation.source.endsWith(".lock");
    const authorities = [
        ...legacyPrimaryAuthorities(preflightResult.primaryCheckoutRoot),
        ...preflightResult.selectedCheckoutRoots.flatMap(legacySelectedAuthorities),
    ];
    return authorities.some((authority) =>
        authority.source === operation.source && authority.destination === operation.destination &&
        authority.kind === operation.kind
    );
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
    await Deno.remove(operation.source).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await syncDirectory(dirname(operation.source));
    operation.completed = true;
    await writeJournal(layout.primary.layoutMigrationJournalPath, markOperation(journal, operation.source, true));
    return undefined;
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
            await createMigrationLockFile(lockPath, token);
            const heartbeat = setInterval(() => {
                updateMigrationLockFile(lockPath, token).catch(() => {});
            }, MIGRATION_LOCK_HEARTBEAT_MS);
            Deno.unrefTimer(heartbeat);
            return {
                release: async () => {
                    clearInterval(heartbeat);
                    await removeMigrationLockIfOwned(lockPath, token);
                },
            };
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            const status = await classifyProcessLock(lockPath, MIGRATION_LOCK_STALE_MS);
            if (status === "stale") {
                await Deno.remove(lockPath).catch(() => {});
                continue;
            }
            await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
        }
    }
}

async function createMigrationLockFile(lockPath: string, token: string): Promise<void> {
    const file = await Deno.open(lockPath, { createNew: true, write: true, mode: 0o600 });
    try {
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
    } finally {
        file.close();
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
