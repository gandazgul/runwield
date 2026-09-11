export type LockFileSnapshot = {
    text: string;
    mtime: number;
    size: number;
    token?: string;
    createdAt?: number;
    updatedAt?: number;
};

type LockFileDocument = {
    token?: string;
    createdAt?: number;
    createdAtMs?: number;
    updatedAt?: number;
    updatedAtMs?: number;
};

export async function readLockFileSnapshot(path: string): Promise<LockFileSnapshot | null> {
    try {
        const text = await Deno.readTextFile(path);
        const stat = await Deno.stat(path);
        return lockFileSnapshotFromStat(text, stat);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

export function lockFileSnapshotMatches(left: LockFileSnapshot, right: LockFileSnapshot): boolean {
    return left.text === right.text && left.mtime === right.mtime && left.size === right.size &&
        left.token === right.token && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt;
}

export async function removeLockFileIfSnapshotMatches(
    lockPath: string,
    snapshot: LockFileSnapshot,
): Promise<boolean> {
    let file: Deno.FsFile;
    try {
        file = await Deno.open(lockPath, { read: true, write: true });
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return true;
        throw error;
    }
    try {
        if (!file.tryLockSync(true)) return false;
        const current = await readLockFileSnapshotFromFile(file);
        const pathCurrent = await readLockFileSnapshot(lockPath);
        if (
            !pathCurrent || !lockFileSnapshotMatches(current, pathCurrent) ||
            !lockFileSnapshotMatches(current, snapshot)
        ) {
            return false;
        }
        await Deno.remove(lockPath).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
        return true;
    } finally {
        file.close();
    }
}

async function readLockFileSnapshotFromFile(file: Deno.FsFile): Promise<LockFileSnapshot> {
    const stat = await file.stat();
    await file.seek(0, Deno.SeekMode.Start);
    const buffer = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
        const read = await file.read(buffer.subarray(offset));
        if (read === null) break;
        offset += read;
    }
    return lockFileSnapshotFromStat(new TextDecoder().decode(buffer.subarray(0, offset)), stat);
}

function lockFileSnapshotFromStat(text: string, stat: Deno.FileInfo): LockFileSnapshot {
    const parsed = parseLockFileDocument(text);
    return {
        text,
        mtime: stat.mtime?.getTime() ?? Date.now(),
        size: stat.size,
        ...(typeof parsed?.token === "string" ? { token: parsed.token } : {}),
        ...(typeof parsed?.createdAt === "number" ? { createdAt: parsed.createdAt } : {}),
        ...(typeof parsed?.createdAtMs === "number" ? { createdAt: parsed.createdAtMs } : {}),
        ...(typeof parsed?.updatedAt === "number" ? { updatedAt: parsed.updatedAt } : {}),
        ...(typeof parsed?.updatedAtMs === "number" ? { updatedAt: parsed.updatedAtMs } : {}),
    };
}

function parseLockFileDocument(text: string): LockFileDocument | null {
    try {
        const value: LockFileDocument = JSON.parse(text);
        return value;
    } catch {
        return null;
    }
}
