import { assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { openFileSessionStore } from "./file-session-store.ts";
import { FileSessionStoreOwner } from "./file-session-store-owner.ts";

Deno.test("FileSessionStoreOwner closes and forgets stores it opens", () => {
    const owner = new FileSessionStoreOwner(null);
    const first = owner.ensure();
    owner.closeOwned();
    const second = owner.ensure();
    try {
        assertNotStrictEquals(second, first);
    } finally {
        owner.closeOwned();
    }
});

Deno.test("FileSessionStoreOwner leaves caller-owned stores open", () => {
    const store = openFileSessionStore();
    const owner = new FileSessionStoreOwner(store);
    try {
        owner.closeOwned();
        assertStrictEquals(owner.current(), store);
    } finally {
        store.close();
    }
});
