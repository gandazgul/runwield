import { assertEquals, assertThrows } from "@std/assert";
import { openOwnerCoordinationDatabase } from "./database.js";
import {
    getProjectHealth,
    listProjectRootEvidence,
    registerProject,
    relinkProject,
    removeProject,
    requireEnabledProjectRoot,
    setProjectEnabled,
} from "./projects.js";

/** @returns {() => string} */
function idFactory() {
    let next = 0;
    return () => `id-${++next}`;
}

Deno.test("Project registration converges symlink duplicates and removal restores the same Project ID", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-reg-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const root = `${dir}/repo`;
        const link = `${dir}/repo-link`;
        await Deno.mkdir(root);
        await Deno.symlink(root, link);
        const ids = idFactory();
        const direct = registerProject(database, { root, idFactory: ids, now: () => "t1" });
        const viaLink = registerProject(database, { root: link, idFactory: ids, now: () => "t2" });
        assertEquals(viaLink.projectId, direct.projectId);
        assertEquals(viaLink.lifecycle, "enabled");
        assertEquals(
            listProjectRootEvidence(database, direct.projectId).map((rootEvidence) => rootEvidence.enteredRoot).sort(),
            [link, root].sort(),
        );

        const removed = removeProject(database, direct.projectId, { now: () => "t3" });
        assertEquals(removed.lifecycle, "removed");
        assertEquals(getProjectHealth(database, direct.projectId).status, "available");
        assertThrows(
            () => requireEnabledProjectRoot(database, direct.projectId),
            Error,
            "not enabled",
        );

        const restored = registerProject(database, { root, idFactory: ids, now: () => "t4" });
        assertEquals(restored.projectId, direct.projectId);
        assertEquals(restored.lifecycle, "enabled");
        assertEquals(requireEnabledProjectRoot(database, direct.projectId), await Deno.realPath(root));
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("disabled Projects stay disabled on duplicate registration", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-disabled-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const root = `${dir}/repo`;
        await Deno.mkdir(root);
        const project = registerProject(database, { root, idFactory: idFactory(), now: () => "t1" });
        setProjectEnabled(database, project.projectId, false, { now: () => "t2" });
        const duplicate = registerProject(database, { root, idFactory: idFactory(), now: () => "t3" });
        assertEquals(duplicate.projectId, project.projectId);
        assertEquals(duplicate.lifecycle, "disabled");
        assertEquals(getProjectHealth(database, project.projectId).status, "available");
        assertThrows(
            () => requireEnabledProjectRoot(database, project.projectId),
            Error,
            "not enabled",
        );
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("Project health is filesystem-based and non-Git directories are available", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-health-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const root = `${dir}/plain-directory`;
        await Deno.mkdir(root);
        const project = registerProject(database, { root, idFactory: idFactory(), now: () => "t1" });
        assertEquals(getProjectHealth(database, project.projectId).status, "available");
        await Deno.remove(root, { recursive: true });
        assertEquals(getProjectHealth(database, project.projectId).status, "missing");
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("Project relink preserves root history and rejects another Project root", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-relink-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const oldRoot = `${dir}/old`;
        const newRoot = `${dir}/new`;
        const otherRoot = `${dir}/other`;
        await Deno.mkdir(oldRoot);
        await Deno.mkdir(newRoot);
        await Deno.mkdir(otherRoot);
        const ids = idFactory();
        const project = registerProject(database, { root: oldRoot, idFactory: ids, now: () => "t1" });
        const other = registerProject(database, { root: otherRoot, idFactory: ids, now: () => "t2" });
        const relinked = relinkProject(database, {
            projectId: project.projectId,
            newRoot,
            idFactory: ids,
            now: () => "t3",
        });
        assertEquals(relinked.projectId, project.projectId);
        assertEquals(relinked.currentRoot, await Deno.realPath(newRoot));
        const roots = listProjectRootEvidence(database, project.projectId);
        assertEquals(roots.map((root) => root.rootState), ["current", "historical"]);
        const duplicateHistorical = registerProject(database, { root: oldRoot, idFactory: ids, now: () => "t4" });
        assertEquals(duplicateHistorical.currentRoot, await Deno.realPath(newRoot));
        assertEquals(
            listProjectRootEvidence(database, project.projectId).filter((root) => root.rootState === "current").map((
                root,
            ) => root.canonicalRoot),
            [await Deno.realPath(newRoot)],
        );
        assertThrows(
            () => relinkProject(database, { projectId: project.projectId, newRoot: otherRoot }),
            Error,
            "another Project",
        );
        assertEquals(requireEnabledProjectRoot(database, other.projectId), await Deno.realPath(otherRoot));
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("Project registration and relink report symlink path reuse conflicts", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-retarget-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const firstRoot = `${dir}/first`;
        const secondRoot = `${dir}/second`;
        const link = `${dir}/project-link`;
        await Deno.mkdir(firstRoot);
        await Deno.mkdir(secondRoot);
        await Deno.symlink(firstRoot, link);
        const project = registerProject(database, { root: link, idFactory: idFactory(), now: () => "t1" });
        await Deno.remove(link);
        await Deno.symlink(secondRoot, link);

        assertThrows(
            () => registerProject(database, { root: link, idFactory: idFactory(), now: () => "t2" }),
            Error,
            "path reuse or symlink retarget",
        );
        assertThrows(
            () => relinkProject(database, { projectId: project.projectId, newRoot: link, idFactory: idFactory() }),
            Error,
            "path reuse or symlink retarget",
        );
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("two database connections racing to register one Project converge on one stable ID", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-race-" });
    const dbPath = `${dir}/owner.sqlite3`;
    const firstDb = openOwnerCoordinationDatabase({ dbPath });
    const secondDb = openOwnerCoordinationDatabase({ dbPath });
    try {
        const root = `${dir}/repo`;
        await Deno.mkdir(root);
        const [first, second] = await Promise.all([
            new Promise((resolvePromise) =>
                setTimeout(
                    () => resolvePromise(registerProject(firstDb, { root, idFactory: idFactory(), now: () => "t1" })),
                    0,
                )
            ),
            new Promise((resolvePromise) =>
                setTimeout(
                    () => resolvePromise(registerProject(secondDb, { root, idFactory: idFactory(), now: () => "t2" })),
                    0,
                )
            ),
        ]);
        assertEquals(/** @type {any} */ (first).projectId, /** @type {any} */ (second).projectId);
    } finally {
        firstDb.close();
        secondDb.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("Project registration rejects files", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-project-file-" });
    const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const file = `${dir}/not-directory`;
        await Deno.writeTextFile(file, "x");
        assertThrows(
            () => registerProject(database, { root: file }),
            Error,
            "must be a directory",
        );
    } finally {
        database.close();
        await Deno.remove(dir, { recursive: true });
    }
});
