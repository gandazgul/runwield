/**
 * @module shared/runtime-preflight
 * Shared startup/execution preflight checks.
 */

const RUNWIELD_INSTALL_URL = "https://github.com/gandazgul/runwield#installation";
const RUNWIELD_INSTALL_COMMAND =
    "curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash";

type RuntimeBinary = "mnemoteca" | "cymbal" | "ketch" | "snip";

interface BinaryCacheRecord {
    path: string;
    available: boolean;
}

const requiredBinaryCache = new Map<RuntimeBinary, BinaryCacheRecord>();

async function hasBinary(binary: RuntimeBinary): Promise<boolean> {
    try {
        const process = new Deno.Command(binary, {
            args: ["--help"],
            stdout: "null",
            stderr: "null",
        }).spawn();
        return (await process.status).success;
    } catch {
        return false;
    }
}

async function hasRequiredBinary(binary: RuntimeBinary): Promise<boolean> {
    const path = Deno.env.get("PATH") || "";
    const cached = requiredBinaryCache.get(binary);
    if (cached?.path === path) return cached.available;

    const available = await hasBinary(binary);
    requiredBinaryCache.set(binary, { path, available });
    return available;
}

function missingBinaryError(displayName: string): Error {
    return new Error(
        [
            `[RunWield] ${displayName} binary not found in PATH.`,
            `Rerun the RunWield installer to install required runtime helpers: ${RUNWIELD_INSTALL_URL}`,
            `Command: ${RUNWIELD_INSTALL_COMMAND}`,
        ].join("\n"),
    );
}

/** Ensure Mnemoteca is available in PATH. */
export async function ensureMnemotecaBinary(): Promise<void> {
    if (!await hasRequiredBinary("mnemoteca")) throw missingBinaryError("Mnemoteca");
}

/** Ensure Cymbal is available in PATH. */
export async function ensureCymbalBinary(): Promise<void> {
    if (!await hasRequiredBinary("cymbal")) throw missingBinaryError("Cymbal");
}

/** Ensure Ketch is available in PATH. */
export async function ensureKetchBinary(): Promise<void> {
    if (!await hasRequiredBinary("ketch")) throw missingBinaryError("Ketch");
}

/** Check whether optional Snip is available in PATH without caching. */
export async function hasSnipBinary(): Promise<boolean> {
    return await hasBinary("snip");
}
