import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { isEmptyProjectDirectory } from "./project-state.js";

/**
 * @param {string} prefix
 * @param {(dir: string) => Promise<void>} fn
 */
async function withTempProject(prefix, fn) {
    const dir = await Deno.makeTempDir({ prefix });
    try {
        await fn(dir);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
}

Deno.test("truly empty directory is empty project directory", async () => {
    await withTempProject("runwield-empty-project-", async (dir) => {
        assertEquals(await isEmptyProjectDirectory(dir), true);
    });
});

Deno.test("only dot-prefixed files and folders are empty project directory", async () => {
    await withTempProject("runwield-dot-project-", async (dir) => {
        await Deno.mkdir(join(dir, ".git"));
        await Deno.mkdir(join(dir, ".wld"));
        await Deno.mkdir(join(dir, ".vscode"));
        await Deno.writeTextFile(join(dir, ".DS_Store"), "metadata");
        await Deno.writeTextFile(join(dir, ".git", "config"), "git config");

        assertEquals(await isEmptyProjectDirectory(dir), true);
    });
});

Deno.test("empty visible folder is empty project directory", async () => {
    await withTempProject("runwield-visible-dir-project-", async (dir) => {
        await Deno.mkdir(join(dir, "src"));

        assertEquals(await isEmptyProjectDirectory(dir), true);
    });
});

Deno.test("zero-byte visible file is empty project directory", async () => {
    await withTempProject("runwield-zero-file-project-", async (dir) => {
        await Deno.writeTextFile(join(dir, "README.md"), "");

        assertEquals(await isEmptyProjectDirectory(dir), true);
    });
});

Deno.test("non-empty visible README is not empty project directory", async () => {
    await withTempProject("runwield-readme-project-", async (dir) => {
        await Deno.writeTextFile(join(dir, "README.md"), "# Project\n");

        assertEquals(await isEmptyProjectDirectory(dir), false);
    });
});

Deno.test("non-empty nested visible file is not empty project directory", async () => {
    await withTempProject("runwield-nested-project-", async (dir) => {
        await Deno.mkdir(join(dir, "src"));
        await Deno.writeTextFile(join(dir, "src", "main.js"), "console.log('hi');\n");

        assertEquals(await isEmptyProjectDirectory(dir), false);
    });
});

Deno.test("non-empty file under dot-prefixed segment is empty project directory", async () => {
    await withTempProject("runwield-dot-nested-project-", async (dir) => {
        await Deno.mkdir(join(dir, ".cache"));
        await Deno.writeTextFile(join(dir, ".cache", "generated.txt"), "generated\n");

        assertEquals(await isEmptyProjectDirectory(dir), true);
    });
});

Deno.test("root read failure degrades to not empty project directory", async () => {
    await withTempProject("runwield-root-read-failure-project-", async (dir) => {
        const originalReadDir = Deno.readDir;
        try {
            Deno.readDir = (path) => {
                if (path === dir) throw new Error("simulated root read failure");
                return originalReadDir(path);
            };

            assertEquals(await isEmptyProjectDirectory(dir), false);
        } finally {
            Deno.readDir = originalReadDir;
        }
    });
});

Deno.test("nested visible directory read failure degrades to not empty project directory", async () => {
    await withTempProject("runwield-nested-read-failure-project-", async (dir) => {
        const srcDir = join(dir, "src");
        await Deno.mkdir(srcDir);

        const originalReadDir = Deno.readDir;
        try {
            Deno.readDir = (path) => {
                if (path === srcDir) throw new Error("simulated nested read failure");
                return originalReadDir(path);
            };

            assertEquals(await isEmptyProjectDirectory(dir), false);
        } finally {
            Deno.readDir = originalReadDir;
        }
    });
});

Deno.test("visible entry stat failure degrades to not empty project directory", async () => {
    await withTempProject("runwield-stat-failure-project-", async (dir) => {
        const readmePath = join(dir, "README.md");
        await Deno.writeTextFile(readmePath, "");

        const originalLstat = Deno.lstat;
        try {
            Deno.lstat = (path) => {
                if (path === readmePath) throw new Error("simulated stat failure");
                return originalLstat(path);
            };

            assertEquals(await isEmptyProjectDirectory(dir), false);
        } finally {
            Deno.lstat = originalLstat;
        }
    });
});
