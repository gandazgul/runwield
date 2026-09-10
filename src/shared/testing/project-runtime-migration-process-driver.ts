import { dirname, join } from "@std/path";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { withPlanLock } from "../../plan-store.js";
import { migrateLegacyProjectRuntimeState, resolveProjectRuntimeLayout } from "../project-runtime-layout.ts";
import { withWorktreeRegistryLockAtPath } from "../worktree-registry.js";
import { acquireRecoveryLock, acquireSupersessionLock } from "../work-records/supersession.ts";

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
    await withPlanLock(checkoutRoot, extra || "demo", async () => {
        console.log(JSON.stringify({ ready: true }));
        await new Promise(() => {});
    });
} else if (command === "hold-work-record-lock") {
    const lockPath = join(getRunWieldRuntimeDir(checkoutRoot), "work-record-supersession.lock");
    await acquireSupersessionLock(checkoutRoot);
    console.log(JSON.stringify({ ready: true, lockPath }));
    await new Promise(() => {});
} else if (command === "hold-work-record-recovery-lock") {
    const lockPath = join(getRunWieldRuntimeDir(checkoutRoot), "work-record-supersession-recovery.lock");
    await acquireRecoveryLock(checkoutRoot);
    console.log(JSON.stringify({ ready: true, lockPath }));
    await new Promise(() => {});
} else {
    console.error(`Unknown project runtime migration process driver command: ${command}`);
    Deno.exit(2);
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
