/**
 * Serialize tests that temporarily mutate process-wide state such as Deno.env
 * or Deno.cwd while Deno test modules run concurrently.
 */

import { join } from "@std/path";

const LOCK_NAME = encodeURIComponent(Deno.cwd()).replaceAll("%", "-");
const LOCK_DIR = join(Deno.env.get("TMPDIR") || "/tmp", `runwield-process-global-test-${LOCK_NAME}.lock`);
const STALE_LOCK_MS = 5 * 60 * 1000;

/** @param {number} ms */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireProcessGlobalTestLock() {
    while (true) {
        try {
            await Deno.mkdir(LOCK_DIR);
            return;
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            try {
                const stat = await Deno.stat(LOCK_DIR);
                if (stat.mtime && Date.now() - stat.mtime.getTime() > STALE_LOCK_MS) {
                    await Deno.remove(LOCK_DIR, { recursive: true });
                    continue;
                }
            } catch (statError) {
                if (!(statError instanceof Deno.errors.NotFound)) throw statError;
            }
            await delay(20);
        }
    }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withProcessGlobalTestLock(fn) {
    await acquireProcessGlobalTestLock();
    try {
        return await fn();
    } finally {
        await Deno.remove(LOCK_DIR, { recursive: true }).catch(() => {});
    }
}
