import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    assertCompatiblePullSecretRecord,
    deleteSecretRecord,
    ensureProjectSecretStoreIgnored,
    getGlobalSecretStorePath,
    getProjectSecretStorePath,
    getSecretRecord,
    PROJECT_SECRET_STORE_RELATIVE_PATH,
    putCompatibleSecretRecord,
    putSecretRecord,
    readSecretStore,
    redactSecretStoreValue,
    resolvePullSecretRecord,
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

Deno.test("pull secret resolution prefers planId-space records across stores", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-resolve-" });
    try {
        const globalPath = join(dir, "global.json");
        const projectPath = join(dir, "project.json");
        await putSecretRecord(globalPath, "plan-1", secretRecord());
        await putSecretRecord(projectPath, "plan-1:space-1", secretRecord());
        const resolved = await resolvePullSecretRecord([globalPath, projectPath], "plan-1", "space-1");
        assertEquals(resolved?.path, projectPath);
        assertEquals(resolved?.key, "plan-1:space-1");
        assertEquals(resolved?.record.maintainerCapability, "maintainer-cap");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("pull secret resolution refuses conflicts across stores and legacy records", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-resolve-conflict-" });
    try {
        const globalPath = join(dir, "global.json");
        const projectPath = join(dir, "project.json");
        await putSecretRecord(projectPath, "plan-1:space-1", secretRecord());
        await putSecretRecord(globalPath, "plan-1", { ...secretRecord(), maintainerCapability: "different-cap" });

        await assertRejects(
            () => resolvePullSecretRecord([projectPath, globalPath], "plan-1", "space-1"),
            Error,
            "Conflicting collaboration secret record for maintainerCapability",
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("URL import compatibility checks all stores before writing target record", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-import-conflict-" });
    try {
        const globalPath = join(dir, "global.json");
        const projectPath = join(dir, "project.json");
        await putSecretRecord(globalPath, "plan-1", { ...secretRecord(), contentKey: "different-key" });

        await assertRejects(
            () => assertCompatiblePullSecretRecord([projectPath, globalPath], "plan-1", "space-1", secretRecord()),
            Error,
            "Conflicting collaboration secret record for contentKey",
        );
        assertEquals(await getSecretRecord(projectPath, "plan-1:space-1"), undefined);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("putCompatibleSecretRecord refuses conflicting imported maintainer secrets", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-conflict-" });
    try {
        const path = join(dir, "store.json");
        await putCompatibleSecretRecord(path, "plan-1:space-1", secretRecord());
        await assertRejects(
            () =>
                putCompatibleSecretRecord(path, "plan-1:space-1", {
                    ...secretRecord(),
                    maintainerCapability: "different-cap",
                }),
            Error,
            "Conflicting collaboration secret record",
        );
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
