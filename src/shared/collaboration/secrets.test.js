import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    deleteSecretRecord,
    ensureProjectSecretStoreIgnored,
    getGlobalSecretStorePath,
    getProjectSecretStorePath,
    getSecretRecord,
    PROJECT_SECRET_STORE_RELATIVE_PATH,
    putSecretRecord,
    readSecretStore,
    redactSecretStoreValue,
    SECRET_STORE_SCHEMA_VERSION,
    writeSecretStore,
} from "./secrets.js";

function secretRecord() {
    return {
        planId: "plan-1",
        spaceId: "space-1",
        contentKey: "content-key",
        reviewerCapability: "reviewer-cap",
        maintainerCapability: "maintainer-cap",
        updatedAt: "2026-07-04T00:00:00.000Z",
    };
}

Deno.test("secret store paths default global and support project-local storage", () => {
    assertEquals(getGlobalSecretStorePath("/home/user"), "/home/user/.wld/collaboration-secrets.json");
    assertEquals(getProjectSecretStorePath("/repo"), "/repo/.wld/collaboration-secrets.json");
});

Deno.test("secret stores read missing files as empty documents and write atomically", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-" });
    try {
        const path = join(dir, ".wld", "collaboration-secrets.json");
        assertEquals(await readSecretStore(path), { schemaVersion: SECRET_STORE_SCHEMA_VERSION, records: {} });
        await putSecretRecord(path, "plan-1", secretRecord());
        assertEquals(await getSecretRecord(path, "plan-1"), secretRecord());
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("secret stores delete records idempotently", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-delete-" });
    try {
        const path = join(dir, ".wld", "collaboration-secrets.json");
        await putSecretRecord(path, "plan-1:space-1", secretRecord());
        await deleteSecretRecord(path, "plan-1:space-1");
        await deleteSecretRecord(path, "plan-1:space-1");
        assertEquals(await getSecretRecord(path, "plan-1:space-1"), undefined);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("secret store rejects corrupt schema with redacted actionable errors", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-corrupt-" });
    try {
        const path = join(dir, "collaboration-secrets.json");
        await Deno.writeTextFile(path, JSON.stringify({ schemaVersion: 999, records: {} }));
        await assertRejects(() => readSecretStore(path), Error, "Unable to read collaboration secret store");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("ensureProjectSecretStoreIgnored creates missing .gitignore with targeted entry", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-gitignore-" });
    try {
        await ensureProjectSecretStoreIgnored(dir);
        assertEquals(await Deno.readTextFile(join(dir, ".gitignore")), `${PROJECT_SECRET_STORE_RELATIVE_PATH}\n`);
        const wldStat = await Deno.stat(join(dir, ".wld"));
        assert(wldStat.isDirectory);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("ensureProjectSecretStoreIgnored is idempotent and preserves existing contents", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-gitignore-existing-" });
    try {
        await Deno.writeTextFile(join(dir, ".gitignore"), "node_modules/\n");
        await ensureProjectSecretStoreIgnored(dir);
        await ensureProjectSecretStoreIgnored(dir);
        const content = await Deno.readTextFile(join(dir, ".gitignore"));
        assertEquals(content, `node_modules/\n${PROJECT_SECRET_STORE_RELATIVE_PATH}\n`);
        assert(content.includes(PROJECT_SECRET_STORE_RELATIVE_PATH));
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("redactSecretStoreValue redacts local secret fields", () => {
    const redacted = redactSecretStoreValue({ records: { "plan-1": secretRecord() } });
    assert(!redacted.includes("content-key"));
    assert(!redacted.includes("reviewer-cap"));
    assert(!redacted.includes("maintainer-cap"));
    assert(redacted.includes("[redacted-capability]"));
});

Deno.test("writeSecretStore validates records before persisting", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-invalid-" });
    try {
        const document = /** @type {import("./secrets.js").SecretStoreDocument} */ ({
            schemaVersion: 1,
            records: { bad: /** @type {any} */ ({}) },
        });
        await assertRejects(() => writeSecretStore(join(dir, "store.json"), document));
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
