import { join } from "@std/path";
import {
    PLAN_BACKUPS_DIR_NAME,
    PLAN_LOCKS_DIR_NAME,
    PLAN_STAGING_DIR_NAME,
    PLAN_TRANSITIONS_DIR_NAME,
    PROJECT_INTERNAL_RUNTIME_DIR_NAME,
    PROJECT_SECRET_STORE_RELATIVE_PATH,
    RUNWIELD_DIR_NAME,
    WORKTREE_REGISTRY_FILE,
    WORKTREE_REGISTRY_LOCK_FILE,
} from "../constants.js";

function underRunWield(name: string): string {
    return `${RUNWIELD_DIR_NAME}/${name}`;
}

const CURRENT_RUNTIME_ROOT = underRunWield(PROJECT_INTERNAL_RUNTIME_DIR_NAME);

const LEGACY_RUNTIME_DIRECTORIES = [
    underRunWield(PLAN_LOCKS_DIR_NAME),
    underRunWield(PLAN_TRANSITIONS_DIR_NAME),
    underRunWield(PLAN_BACKUPS_DIR_NAME),
    underRunWield(PLAN_STAGING_DIR_NAME),
    underRunWield("worktrees"),
    underRunWield("debug"),
    underRunWield("controller"),
];

const LEGACY_RUNTIME_FILES = [
    underRunWield(WORKTREE_REGISTRY_FILE),
    underRunWield(WORKTREE_REGISTRY_LOCK_FILE),
    underRunWield("worktree-registry-migration-issues.json"),
    PROJECT_SECRET_STORE_RELATIVE_PATH,
    underRunWield("work-record-supersession.lock"),
    underRunWield("work-record-supersession-recovery.lock"),
];

const LEGACY_RUNTIME_TEMP_FILE_PATTERNS = [
    `${underRunWield(WORKTREE_REGISTRY_FILE)}.*.tmp`,
    `${PROJECT_SECRET_STORE_RELATIVE_PATH}.*.tmp`,
];

export const CURRENT_PROJECT_RUNTIME_PATHS = Object.freeze([CURRENT_RUNTIME_ROOT]);
export const LEGACY_PROJECT_RUNTIME_HAZARD_PATHS = Object.freeze([
    ...LEGACY_RUNTIME_DIRECTORIES,
    ...LEGACY_RUNTIME_FILES,
    ...LEGACY_RUNTIME_TEMP_FILE_PATTERNS,
]);
export const RUNWIELD_OWNED_RUNTIME_PATHS = Object.freeze([
    ...CURRENT_PROJECT_RUNTIME_PATHS,
    ...LEGACY_PROJECT_RUNTIME_HAZARD_PATHS,
]);

function normalizeGitPath(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function isAtomicTempPath(path: string, filePath: string): boolean {
    const prefix = `${filePath}.`;
    const suffix = ".tmp";
    if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
    const token = path.slice(prefix.length, -suffix.length);
    return token.length > 0 && !token.includes("/");
}

function isLegacyRuntimeTempPath(path: string): boolean {
    return isAtomicTempPath(path, underRunWield(WORKTREE_REGISTRY_FILE)) ||
        isAtomicTempPath(path, PROJECT_SECRET_STORE_RELATIVE_PATH);
}

export function isCurrentProjectRuntimePath(path: string): boolean {
    const normalized = normalizeGitPath(path);
    return normalized === CURRENT_RUNTIME_ROOT || normalized.startsWith(`${CURRENT_RUNTIME_ROOT}/`);
}

export function isLegacyProjectRuntimeHazardPath(path: string): boolean {
    const normalized = normalizeGitPath(path);
    if (!normalized || normalized === RUNWIELD_DIR_NAME || isCurrentProjectRuntimePath(normalized)) return false;
    if (isLegacyRuntimeTempPath(normalized)) return true;
    for (const dir of LEGACY_RUNTIME_DIRECTORIES) {
        if (normalized === dir || normalized.startsWith(`${dir}/`)) return true;
    }
    return LEGACY_RUNTIME_FILES.some((file) => normalized === file);
}

export function isRunWieldOwnedRuntimePath(path: string): boolean {
    return isCurrentProjectRuntimePath(path) || isLegacyProjectRuntimeHazardPath(path);
}

export const runwieldOwnedPathspecExclusions = Object.freeze(
    RUNWIELD_OWNED_RUNTIME_PATHS.map((path) => {
        const isDirectory = CURRENT_PROJECT_RUNTIME_PATHS.includes(path) || LEGACY_RUNTIME_DIRECTORIES.includes(path);
        return `:(exclude)${path}${isDirectory ? "/**" : ""}`;
    }),
);

const GITIGNORE_START = "# BEGIN RunWield owned runtime state";
const GITIGNORE_END = "# END RunWield owned runtime state";

export const RUNWIELD_GITIGNORE_BLOCK = `${GITIGNORE_START}\n${
    RUNWIELD_OWNED_RUNTIME_PATHS.join("\n")
}\n${GITIGNORE_END}\n`;

export async function ensureRunWieldOwnedGitignoreBlock(projectRoot: string): Promise<void> {
    const gitignorePath = join(projectRoot, ".gitignore");
    let existing = "";
    try {
        existing = await Deno.readTextFile(gitignorePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const pattern = new RegExp(
        `${GITIGNORE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${
            GITIGNORE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        }\\n?`,
    );
    const next = pattern.test(existing)
        ? existing.replace(pattern, RUNWIELD_GITIGNORE_BLOCK)
        : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${RUNWIELD_GITIGNORE_BLOCK}`;
    if (next !== existing) await Deno.writeTextFile(gitignorePath, next);
}
