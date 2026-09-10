/** Browser drafts, including images, use IndexedDB rather than localStorage's small text quota. */
const drafts = new Map<string, string | null>();
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
    database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open("runwield-session-drafts", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("drafts");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Draft storage is unavailable."));
    });
    return database;
}

export function readSessionDraft(key: string): string | null {
    if (drafts.has(key)) return drafts.get(key) ?? null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export async function loadSessionDrafts(keys: string[]): Promise<void> {
    try {
        const db = await openDatabase();
        await Promise.all(keys.map((key) =>
            new Promise<void>((resolve, reject) => {
                const request = db.transaction("drafts").objectStore("drafts").get(key);
                request.onsuccess = () => {
                    if (!drafts.has(key) && typeof request.result === "string") drafts.set(key, request.result);
                    resolve();
                };
                request.onerror = () => reject(request.error);
            })
        ));
    } catch { /* In restricted browsers the current tab still keeps its draft. */ }
}

export async function saveSessionDraft(key: string, value: string | null): Promise<boolean> {
    drafts.set(key, value);
    try {
        const db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("drafts", "readwrite");
            const store = transaction.objectStore("drafts");
            if (value === null) store.delete(key);
            else store.put(value, key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        try {
            localStorage.removeItem(key);
        } catch { /* Legacy storage may be disabled. */ }
        return true;
    } catch {
        // Storage failure must never block sending, discard an image, or leave Send stuck.
        return false;
    }
}
