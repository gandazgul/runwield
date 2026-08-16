import { type FileSessionStore, openFileSessionStore } from "./file-session-store.ts";

/** Owns only stores created inside SessionRuntime. */
export class FileSessionStoreOwner {
    #store: FileSessionStore | null;
    #ownsStore: boolean;

    constructor(store: FileSessionStore | null, ownsStore = false) {
        this.#store = store;
        this.#ownsStore = Boolean(store && ownsStore);
    }

    current(): FileSessionStore | null {
        return this.#store;
    }

    ensure(): FileSessionStore {
        if (!this.#store) {
            this.#store = openFileSessionStore();
            this.#ownsStore = true;
        }
        return this.#store;
    }

    closeOwned(): void {
        if (!this.#store || !this.#ownsStore) return;
        this.#store.close();
        this.#store = null;
        this.#ownsStore = false;
    }
}
