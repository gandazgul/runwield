import { assertEquals, assertFalse, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { getLatestOwnerCoordinationSchemaVersion, openOwnerCoordinationDatabase } from "./database.js";
import { OWNER_COORDINATION_SCHEMA_VERSION } from "./schema.js";

/** @param {string} path */
async function exists(path) {
    try {
        await Deno.stat(path);
        return true;
    } catch {
        return false;
    }
}

Deno.test("owner database opens on disk with schema, WAL, foreign keys, and rollback-safe transactions", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-db-" });
    const dbPath = `${dir}/owner.sqlite3`;
    try {
        const database = openOwnerCoordinationDatabase({ dbPath });
        try {
            assertEquals(getLatestOwnerCoordinationSchemaVersion(database.handle), OWNER_COORDINATION_SCHEMA_VERSION);
            const foreignKeys =
                /** @type {{ foreign_keys: number }} */ (database.handle.prepare("PRAGMA foreign_keys").get());
            assertEquals(foreignKeys.foreign_keys, 1);
            const journalMode =
                /** @type {{ journal_mode: string }} */ (database.handle.prepare("PRAGMA journal_mode").get());
            assertEquals(String(journalMode.journal_mode).toLowerCase(), "wal");
            assertThrows(
                () =>
                    database.transaction(() => {
                        database.handle.prepare(
                            "INSERT INTO projects(id, display_name, registered_root, current_root, lifecycle, created_at, updated_at) VALUES ('rollback', 'Rollback', '/tmp/a', '/tmp/a', 'enabled', 'now', 'now')",
                        ).run();
                        throw new Error("rollback");
                    }),
                Error,
                "rollback",
            );
            const row = database.handle.prepare("SELECT id FROM projects WHERE id = 'rollback'").get();
            assertEquals(row, undefined);
        } finally {
            database.close();
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("owner database refuses newer schema without recording local migrations", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-newer-" });
    const dbPath = `${dir}/owner.sqlite3`;
    try {
        const fixture = new DatabaseSync(dbPath);
        fixture.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
        fixture.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(999, "future");
        fixture.close();

        assertThrows(
            () => openOwnerCoordinationDatabase({ dbPath }),
            Error,
            "newer than supported",
        );

        const check = new DatabaseSync(dbPath);
        try {
            const rows = check.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
            assertEquals(rows.map((row) => row.version), [999]);
            const projectsTable = check.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
            ).get();
            assertEquals(projectsTable, undefined);
            const journalMode = /** @type {{ journal_mode: string }} */ (check.prepare("PRAGMA journal_mode").get());
            assertFalse(["wal"].includes(String(journalMode.journal_mode).toLowerCase()));
            assertFalse(await exists(`${dbPath}-wal`));
            assertFalse(await exists(`${dbPath}-shm`));
        } finally {
            check.close();
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("owner database reports corrupted files visibly and does not delete them", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-corrupt-" });
    const dbPath = `${dir}/owner.sqlite3`;
    try {
        await Deno.writeTextFile(dbPath, "not sqlite");
        assertThrows(
            () => openOwnerCoordinationDatabase({ dbPath }),
            Error,
        );
        assertEquals(await Deno.readTextFile(dbPath), "not sqlite");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
