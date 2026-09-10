import { dirname, join } from "@std/path";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { getLockHostname } from "../process-liveness.ts";
import { migrateLegacyProjectRuntimeState, resolveProjectRuntimeLayout } from "../project-runtime-layout.ts";
import { withWorktreeRegistryLockAtPath } from "../worktree-registry.js";

interface LegacyPlanLockRecord {
    token: string;
    pid: number;
    hostname: string;
    updatedAtMs: number;
}

interface LegacyWorkRecordLockRecord {
    token: string;
    createdAt: number;
    updatedAt: number;
}

type MigrationExitEffect =
    | "journal-commit"
    | "primary-rename"
    | "selected-rename"
    | "stale-lock-retirement"
    | "marker-replacement"
    | "journal-cleanup";

const [command, checkoutRoot, extra] = Deno.args;

if (command === "migrate") {
    const result = await migrateLegacyProjectRuntimeState(checkoutRoot);
    console.log(JSON.stringify(result));
} else if (command === "migrate-exit-after-effect") {
    installExitAfterEffect(checkoutRoot, parseMigrationExitEffect(extra));
    const result = await migrateLegacyProjectRuntimeState(checkoutRoot);
    console.log(JSON.stringify(result));
} else if (command === "hold-controller-lock") {
    const lockPath = extra || join(getRunWieldRuntimeDir(checkoutRoot), "controller", "plans", "driver.json.lock");
    await Deno.mkdir(dirname(lockPath), { recursive: true }).catch(() => {});
    const file = await Deno.open(lockPath, { create: true, read: true, write: true });
    await file.lock(true);
    console.log(JSON.stringify({ ready: true, lockPath }));
    await new Promise(() => {});
} else if (command === "hold-registry-lock") {
    const lockPath = join(getRunWieldRuntimeDir(checkoutRoot), "worktrees.lock");
    await withWorktreeRegistryLockAtPath(lockPath, async () => {
        console.log(JSON.stringify({ ready: true, lockPath }));
        await new Promise(() => {});
    });
} else if (command === "hold-plan-lock") {
    await holdLegacyPlanLock(checkoutRoot, extra || "demo");
} else if (command === "hold-work-record-lock") {
    await holdLegacyWorkRecordLock(checkoutRoot, "work-record-supersession.lock");
} else if (command === "hold-work-record-recovery-lock") {
    await holdLegacyWorkRecordLock(checkoutRoot, "work-record-supersession-recovery.lock");
} else {
    console.error(`Unknown project runtime migration process driver command: ${command}`);
    Deno.exit(2);
}

async function holdLegacyPlanLock(checkoutRoot: string, planName: string): Promise<never> {
    const lockPath = join(getRunWieldRuntimeDir(checkoutRoot), "plan-locks", `${lockSafeSegment(planName)}.lock`);
    await Deno.mkdir(dirname(lockPath), { recursive: true });
    const file = await Deno.open(lockPath, { createNew: true, read: true, write: true });
    file.lockSync(true);
    const token = crypto.randomUUID();
    await writePlanLockFile(file, { token, pid: Deno.pid, hostname: getLockHostname(), updatedAtMs: Date.now() });
    const heartbeat = setInterval(() => {
        writePlanLockFile(file, { token, pid: Deno.pid, hostname: getLockHostname(), updatedAtMs: Date.now() }).catch(
            () => {},
        );
    }, 1_000);
    Deno.unrefTimer(heartbeat);
    console.log(JSON.stringify({ ready: true, lockPath }));
    return await new Promise<never>(() => {});
}

async function holdLegacyWorkRecordLock(checkoutRoot: string, lockName: string): Promise<never> {
    const lockPath = join(getRunWieldRuntimeDir(checkoutRoot), lockName);
    await Deno.mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const file = await Deno.open(lockPath, { createNew: true, read: true, write: true, mode: 0o600 });
    file.lockSync(true);
    const token = crypto.randomUUID();
    const now = Date.now();
    await writeWorkRecordLockFile(file, { token, createdAt: now, updatedAt: now });
    const heartbeat = setInterval(() => {
        writeWorkRecordLockFile(file, { token, createdAt: now, updatedAt: Date.now() }).catch(() => {});
    }, 1_000);
    Deno.unrefTimer(heartbeat);
    console.log(JSON.stringify({ ready: true, lockPath }));
    return await new Promise<never>(() => {});
}

function lockSafeSegment(value: string): string {
    return String(value || "plan").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
}

async function writePlanLockFile(file: Deno.FsFile, record: LegacyPlanLockRecord): Promise<void> {
    await writeJsonFile(file, `${JSON.stringify(record)}\n`);
}

async function writeWorkRecordLockFile(file: Deno.FsFile, record: LegacyWorkRecordLockRecord): Promise<void> {
    await writeJsonFile(file, `${JSON.stringify(record)}\n`);
}

async function writeJsonFile(file: Deno.FsFile, text: string): Promise<void> {
    await file.truncate(0);
    await file.seek(0, Deno.SeekMode.Start);
    await file.write(new TextEncoder().encode(text));
    await file.sync();
}

function parseMigrationExitEffect(value: string | undefined): MigrationExitEffect {
    if (
        value === "journal-commit" || value === "primary-rename" || value === "selected-rename" ||
        value === "stale-lock-retirement" || value === "marker-replacement" || value === "journal-cleanup"
    ) return value;
    console.error(`Unknown migration exit effect: ${value || ""}`);
    Deno.exit(2);
}

function installExitAfterEffect(checkoutRoot: string, effect: MigrationExitEffect): void {
    const layout = resolveProjectRuntimeLayout(checkoutRoot);
    const legacyBase = getRunWieldRuntimeDir(checkoutRoot);
    const originalRename = Deno.rename;
    const originalRemove = Deno.remove;
    Object.defineProperty(Deno, "rename", {
        configurable: true,
        value: async (from: string | URL, to: string | URL): Promise<void> => {
            await originalRename(from, to);
            if (typeof from === "string" && typeof to === "string" && shouldExitAfterRename(effect, from, to, layout)) {
                Deno.exit(86);
            }
        },
    });
    Object.defineProperty(Deno, "remove", {
        configurable: true,
        value: async (path: string | URL, options?: Deno.RemoveOptions): Promise<void> => {
            await originalRemove(path, options);
            if (typeof path === "string" && shouldExitAfterRemove(effect, path, layout, legacyBase)) {
                Deno.exit(86);
            }
        },
    });
}

function shouldExitAfterRename(
    effect: MigrationExitEffect,
    from: string,
    to: string,
    layout: ReturnType<typeof resolveProjectRuntimeLayout>,
): boolean {
    if (effect === "journal-commit") return to === layout.primary.layoutMigrationJournalPath;
    if (effect === "primary-rename") {
        return from === join(getRunWieldRuntimeDir(layout.primary.checkoutRoot), "controller");
    }
    if (effect === "selected-rename") {
        return from === join(getRunWieldRuntimeDir(layout.selected.checkoutRoot), "plan-transitions");
    }
    return effect === "marker-replacement" && to === layout.primary.layoutMarkerPath;
}

function shouldExitAfterRemove(
    effect: MigrationExitEffect,
    path: string,
    layout: ReturnType<typeof resolveProjectRuntimeLayout>,
    legacyBase: string,
): boolean {
    if (effect === "stale-lock-retirement") return path === join(legacyBase, "plan-locks", "demo.lock");
    return effect === "journal-cleanup" && path === layout.primary.layoutMigrationJournalPath;
}
