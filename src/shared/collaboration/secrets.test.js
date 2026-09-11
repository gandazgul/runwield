import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PROJECT_SECRET_STORE_RELATIVE_PATH } from "../../constants.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { resolveProjectRuntimeLayout } from "../project-runtime-layout.ts";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import {
    assertCompatiblePullSecretRecord,
    deleteCompatibleSecretRecords,
    deleteSecretRecord,
    ensureProjectSecretStoreIgnored,
    getGlobalSecretStorePath,
    getProjectSecretStorePath,
    getSecretRecord,
    putCompatibleSecretRecord,
    putSecretRecord,
    readSecretStore,
    redactSecretStoreValue,
    resolveCompatibleSecretRecord,
    resolvePullSecretRecord,
    SECRET_STORE_SCHEMA_VERSION,
    writeSecretStore,
} from "./secrets.js";

const gitFixture = defineCommittedGitFixture({ "README.md": "# Collaboration secrets fixture\n" });

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

Deno.test("secret store paths keep global home storage and route project storage through primary runtime layout", async () => {
    assertEquals(getGlobalSecretStorePath("/home/user"), "/home/user/.wld/collaboration-secrets.json");
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const primaryCheckout = await gitFixture.checkout({ prefix: "runwield-secrets-primary-" });
        const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-secrets-linked-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            await git(primaryCheckout, [
                "worktree",
                "add",
                "-b",
                `secrets-path-test-${crypto.randomUUID()}`,
                selectedCheckout,
            ]);
            const layout = resolveProjectRuntimeLayout(selectedCheckout);
            assertEquals(getProjectSecretStorePath(selectedCheckout), layout.primary.projectSecretStorePath);
            assertEquals(
                getProjectSecretStorePath(selectedCheckout).startsWith(await Deno.realPath(primaryCheckout)),
                true,
            );
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(selectedCheckout, { recursive: true }).catch(() => {});
            await Deno.remove(primaryCheckout, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("secret stores read missing files as empty documents and write atomically", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-" });
    try {
        const path = join(dir, ".wld", "collaboration-secrets.json");
        assertEquals(await readSecretStore(path), { schemaVersion: SECRET_STORE_SCHEMA_VERSION, records: {} });
        await putSecretRecord(path, "plan-1", secretRecord());
        assertEquals(await getSecretRecord(path, "plan-1"), secretRecord());
        assertEquals(((await Deno.stat(path)).mode ?? 0) & 0o777, 0o600);
        const siblingTemps = [];
        for await (const entry of Deno.readDir(join(dir, ".wld"))) {
            if (entry.name.includes(".tmp")) siblingTemps.push(entry.name);
        }
        assertEquals(siblingTemps, []);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("project secret writes from linked checkouts populate only the primary internal store", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const primaryCheckout = await gitFixture.checkout({ prefix: "runwield-secrets-write-primary-" });
        const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-secrets-write-linked-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            await git(primaryCheckout, [
                "worktree",
                "add",
                "-b",
                `secrets-write-test-${crypto.randomUUID()}`,
                selectedCheckout,
            ]);
            const primaryLayout = resolveProjectRuntimeLayout(primaryCheckout);
            const selectedPath = getProjectSecretStorePath(selectedCheckout);
            await putSecretRecord(selectedPath, "plan-1:space-1", secretRecord());

            assertEquals(selectedPath, primaryLayout.primary.projectSecretStorePath);
            assertEquals(
                (await readSecretStore(join(primaryCheckout, ".wld", "internal", "collaboration-secrets.json")))
                    .records["plan-1:space-1"],
                secretRecord(),
            );
            await assertRejects(
                () => Deno.stat(join(primaryCheckout, PROJECT_SECRET_STORE_RELATIVE_PATH)),
                Deno.errors.NotFound,
            );
            await assertRejects(
                () => Deno.stat(join(selectedCheckout, PROJECT_SECRET_STORE_RELATIVE_PATH)),
                Deno.errors.NotFound,
            );
            await assertRejects(
                () => Deno.stat(join(selectedCheckout, ".wld", "internal", "collaboration-secrets.json")),
                Deno.errors.NotFound,
            );
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(selectedCheckout, { recursive: true }).catch(() => {});
            await Deno.remove(primaryCheckout, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("project secret path honors sandbox routing", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-sandbox-" });
    const sandboxHome = await Deno.makeTempDir({ prefix: "runwield-secrets-sandbox-home-" });
    const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
    try {
        Deno.env.set("WLD_TEST_SANDBOX_HOME", sandboxHome);
        assertEquals(
            getProjectSecretStorePath(dir),
            resolveProjectRuntimeLayout(dir).primary.projectSecretStorePath,
        );
        assert(getProjectSecretStorePath(dir).startsWith(sandboxHome));
    } finally {
        if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
        else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
        await Deno.remove(dir, { recursive: true }).catch(() => {});
        await Deno.remove(sandboxHome, { recursive: true }).catch(() => {});
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

Deno.test("deleteCompatibleSecretRecords clears pair and legacy records across stores", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-unshare-" });
    try {
        const globalPath = join(dir, "global.json");
        const projectPath = join(dir, "project.json");
        await putSecretRecord(globalPath, "plan-1:space-1", secretRecord());
        await putSecretRecord(globalPath, "plan-1", secretRecord());
        await putSecretRecord(projectPath, "plan-1", { ...secretRecord(), reviewerCapability: "project-reviewer" });
        await putSecretRecord(projectPath, "plan-1:other-space", { ...secretRecord(), spaceId: "other-space" });

        const deleted = await deleteCompatibleSecretRecords([globalPath, projectPath], "plan-1", "space-1");

        assertEquals(
            deleted.map((entry) => `${entry.path}:${entry.key}`).sort(),
            [
                `${globalPath}:plan-1`,
                `${globalPath}:plan-1:space-1`,
                `${projectPath}:plan-1`,
            ].sort(),
        );
        assertEquals(await getSecretRecord(globalPath, "plan-1"), undefined);
        assertEquals(await getSecretRecord(globalPath, "plan-1:space-1"), undefined);
        assertEquals(await getSecretRecord(projectPath, "plan-1"), undefined);
        assertEquals((await getSecretRecord(projectPath, "plan-1:other-space"))?.spaceId, "other-space");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("deleteCompatibleSecretRecords tolerates missing stores", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-unshare-missing-" });
    try {
        assertEquals(await deleteCompatibleSecretRecords([join(dir, "missing.json")], "plan-1", "space-1"), []);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("deleteCompatibleSecretRecords preserves unrelated legacy space records", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-unshare-preserve-" });
    try {
        const path = join(dir, "store.json");
        await putSecretRecord(path, "plan-1", { ...secretRecord(), spaceId: "other-space" });

        assertEquals(await deleteCompatibleSecretRecords([path], "plan-1", "space-1"), []);
        assertEquals((await getSecretRecord(path, "plan-1"))?.spaceId, "other-space");
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

Deno.test("compatible secret resolution ignores records bound to other Shared Spaces", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-compatible-" });
    try {
        const globalPath = join(dir, "global.json");
        const projectPath = join(dir, "project.json");
        await putSecretRecord(globalPath, "plan-1", { ...secretRecord(), spaceId: "other-space" });
        await putSecretRecord(projectPath, "plan-1:space-1", secretRecord());

        const resolved = await resolveCompatibleSecretRecord([globalPath, projectPath], "plan-1", "space-1");

        assertEquals(resolved?.path, projectPath);
        assertEquals(resolved?.key, "plan-1:space-1");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("compatible secret resolution returns null for only unrelated space records", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-secrets-compatible-null-" });
    try {
        const path = join(dir, "store.json");
        await putSecretRecord(path, "plan-1", { ...secretRecord(), spaceId: "other-space" });

        assertEquals(await resolveCompatibleSecretRecord([path], "plan-1", "space-1"), null);
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

Deno.test("ensureProjectSecretStoreIgnored protects the primary managed runtime block from linked checkouts", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const primaryCheckout = await gitFixture.checkout({ prefix: "runwield-gitignore-primary-" });
        const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-gitignore-linked-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            await Deno.writeTextFile(join(primaryCheckout, ".gitignore"), "node_modules/\n");
            await git(primaryCheckout, [
                "worktree",
                "add",
                "-b",
                `secrets-ignore-test-${crypto.randomUUID()}`,
                selectedCheckout,
            ]);
            await Deno.writeTextFile(join(selectedCheckout, ".gitignore"), "selected-only\n");

            await ensureProjectSecretStoreIgnored(selectedCheckout);
            const first = await Deno.readTextFile(join(primaryCheckout, ".gitignore"));
            await ensureProjectSecretStoreIgnored(selectedCheckout);

            assertEquals(await Deno.readTextFile(join(primaryCheckout, ".gitignore")), first);
            assert(first.startsWith("node_modules/\n"));
            assert(first.includes("# BEGIN RunWield owned runtime state\n"));
            assertEquals(
                first.includes(`\n${PROJECT_SECRET_STORE_RELATIVE_PATH}\n${PROJECT_SECRET_STORE_RELATIVE_PATH}\n`),
                false,
            );
            assertEquals(await Deno.readTextFile(join(selectedCheckout, ".gitignore")), "selected-only\n");
            assert((await Deno.stat(resolveProjectRuntimeLayout(selectedCheckout).primary.internalRoot)).isDirectory);
            assertEquals(
                await git(primaryCheckout, ["check-ignore", ".wld/internal/collaboration-secrets.json"]),
                ".wld/internal/collaboration-secrets.json",
            );
            assertEquals(
                await git(primaryCheckout, ["check-ignore", ".wld/internal/collaboration-secrets.json.token.tmp"]),
                ".wld/internal/collaboration-secrets.json.token.tmp",
            );
            for (
                const path of [".wld/settings.json", ".wld/agents/a.md", ".wld/skills/s/SKILL.md", ".wld/prompts/a.md"]
            ) {
                await assertRejects(() => git(primaryCheckout, ["check-ignore", path]));
            }
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(selectedCheckout, { recursive: true }).catch(() => {});
            await Deno.remove(primaryCheckout, { recursive: true }).catch(() => {});
        }
    });
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
