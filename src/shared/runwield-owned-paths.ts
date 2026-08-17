import {
    PLAN_BACKUPS_DIR_NAME,
    PLAN_LOCKS_DIR_NAME,
    PLAN_STAGING_DIR_NAME,
    PLAN_TRANSITIONS_DIR_NAME,
    RUNWIELD_DIR_NAME,
    WORKTREE_REGISTRY_FILE,
    WORKTREE_REGISTRY_LOCK_FILE,
} from "../constants.js";
import { PROJECT_SECRET_STORE_RELATIVE_PATH } from "./collaboration/secrets.js";

function underRunWield(name: string): string {
    return `${RUNWIELD_DIR_NAME}/${name}`;
}

const OWNED_DIRECTORIES = [
    underRunWield(PLAN_LOCKS_DIR_NAME),
    underRunWield(PLAN_TRANSITIONS_DIR_NAME),
    underRunWield(PLAN_BACKUPS_DIR_NAME),
    underRunWield(PLAN_STAGING_DIR_NAME),
    underRunWield("worktrees"),
    underRunWield("debug"),
];

const OWNED_FILES = [
    underRunWield(WORKTREE_REGISTRY_FILE),
    underRunWield(WORKTREE_REGISTRY_LOCK_FILE),
    underRunWield("worktree-registry-migration-issues.json"),
    PROJECT_SECRET_STORE_RELATIVE_PATH,
];

export const RUNWIELD_OWNED_RUNTIME_PATHS = Object.freeze([...OWNED_DIRECTORIES, ...OWNED_FILES]);

function normalizeGitPath(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function isWorktreeRegistryTempPath(path: string): boolean {
    const prefix = `${underRunWield(WORKTREE_REGISTRY_FILE)}.`;
    const suffix = ".tmp";
    if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
    const token = path.slice(prefix.length, -suffix.length);
    return token.length > 0 && !token.includes("/");
}

export function isRunWieldOwnedRuntimePath(path: string): boolean {
    const normalized = normalizeGitPath(path);
    if (!normalized || normalized === RUNWIELD_DIR_NAME) return false;
    if (isWorktreeRegistryTempPath(normalized)) return true;
    for (const dir of OWNED_DIRECTORIES) {
        if (normalized === dir || normalized.startsWith(`${dir}/`)) return true;
    }
    const worktreeRegistryTempPrefix = `${underRunWield(WORKTREE_REGISTRY_FILE)}.`;
    if (normalized.startsWith(worktreeRegistryTempPrefix) && normalized.endsWith(".tmp")) return true;
    return OWNED_FILES.some((file) => normalized === file || normalized.startsWith(`${file}/`));
}

export const runwieldOwnedPathspecExclusions = Object.freeze(
    RUNWIELD_OWNED_RUNTIME_PATHS.map((path) => `:(exclude)${path}${OWNED_DIRECTORIES.includes(path) ? "/**" : ""}`),
);

const GITIGNORE_START = "# BEGIN RunWield owned runtime state";
const GITIGNORE_END = "# END RunWield owned runtime state";

export const RUNWIELD_GITIGNORE_BLOCK = `${GITIGNORE_START}\n${
    RUNWIELD_OWNED_RUNTIME_PATHS.join("\n")
}\n${GITIGNORE_END}\n`;
