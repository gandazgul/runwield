import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

import {
    DOMAIN_LANGUAGE_PATHS,
    formatDomainLanguageMigrationMessages,
    migrateDomainLanguageArtifacts,
} from "./domain-language.ts";

async function makeProject(prefix: string): Promise<string> {
    return await Deno.makeTempDir({ prefix });
}

async function cleanup(path: string): Promise<void> {
    try {
        await Deno.remove(path, { recursive: true });
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

const REPO_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))));

Deno.test("domain-language migration moves an exact-uppercase single-context glossary and is idempotent", async () => {
    const projectRoot = await makeProject("runwield-domain-language-single-");
    try {
        await Deno.writeTextFile(join(projectRoot, "CONTEXT.md"), "# Legacy\n\nComplete content.\n");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.warnings, []);
        assertEquals(result.notices.length, 1);
        assertEquals(
            await Deno.readTextFile(join(projectRoot, DOMAIN_LANGUAGE_PATHS.singleContext)),
            "# Legacy\n\nComplete content.\n",
        );
        assertEquals(await exists(join(projectRoot, "CONTEXT.md")), false);

        const rerun = await migrateDomainLanguageArtifacts(projectRoot);
        assertEquals(rerun, { notices: [], warnings: [] });
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language migration creates docs when it is missing and ignores lowercase and mixed-case files", async () => {
    const projectRoot = await makeProject("runwield-domain-language-case-");
    try {
        await Deno.writeTextFile(join(projectRoot, "context.md"), "lower");
        await Deno.writeTextFile(join(projectRoot, "context-map.md"), "lower map");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result, { notices: [], warnings: [] });
        assertEquals(await Deno.readTextFile(join(projectRoot, "context.md")), "lower");
        assertEquals(await Deno.readTextFile(join(projectRoot, "context-map.md")), "lower map");
        assertEquals(await exists(join(projectRoot, "docs")), false);
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language migration preserves both sides when a canonical destination already exists", async () => {
    const projectRoot = await makeProject("runwield-domain-language-conflict-");
    try {
        await Deno.mkdir(join(projectRoot, "docs"));
        await Deno.writeTextFile(join(projectRoot, "CONTEXT.md"), "source");
        await Deno.writeTextFile(join(projectRoot, DOMAIN_LANGUAGE_PATHS.singleContext), "existing");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.notices, []);
        assertEquals(result.warnings[0].code, "destination_conflict");
        assertEquals(await Deno.readTextFile(join(projectRoot, "CONTEXT.md")), "source");
        assertEquals(await Deno.readTextFile(join(projectRoot, DOMAIN_LANGUAGE_PATHS.singleContext)), "existing");
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language migration rejects symlink and non-file sources without deleting them", async () => {
    const projectRoot = await makeProject("runwield-domain-language-non-file-");
    try {
        await Deno.mkdir(join(projectRoot, "CONTEXT.md"));
        const result = await migrateDomainLanguageArtifacts(projectRoot);
        assertEquals(result.warnings[0].code, "non_file_source");
        assert((await Deno.lstat(join(projectRoot, "CONTEXT.md"))).isDirectory);
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language migration rewrites a multi-context map and moves referenced glossaries as a unit", async () => {
    const projectRoot = await makeProject("runwield-domain-language-map-");
    try {
        await Deno.mkdir(join(projectRoot, "one"), { recursive: true });
        await Deno.mkdir(join(projectRoot, "two"), { recursive: true });
        await Deno.writeTextFile(
            join(projectRoot, "CONTEXT-MAP.md"),
            [
                "# Contexts",
                '- [One](./one/CONTEXT.md#terms "One title")',
                "- [Two](two/CONTEXT.md)",
                "- [External](https://example.com/CONTEXT.md)",
            ].join("\n"),
        );
        await Deno.writeTextFile(join(projectRoot, "one", "CONTEXT.md"), "one");
        await Deno.writeTextFile(join(projectRoot, "two", "CONTEXT.md"), "two");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.warnings, []);
        assertEquals(await exists(join(projectRoot, "CONTEXT-MAP.md")), false);
        assertEquals(await exists(join(projectRoot, "one", "CONTEXT.md")), false);
        assertEquals(await exists(join(projectRoot, "two", "CONTEXT.md")), false);
        assertEquals(await Deno.readTextFile(join(projectRoot, "one", "domain-language.md")), "one");
        assertEquals(await Deno.readTextFile(join(projectRoot, "two", "domain-language.md")), "two");
        const rewrittenMap = await Deno.readTextFile(join(projectRoot, DOMAIN_LANGUAGE_PATHS.multiContextMap));
        assertStringIncludes(rewrittenMap, "./one/domain-language.md#terms");
        assertStringIncludes(rewrittenMap, "two/domain-language.md");
        assertStringIncludes(rewrittenMap, "https://example.com/CONTEXT.md");

        const rerun = await migrateDomainLanguageArtifacts(projectRoot);
        assertEquals(rerun, { notices: [], warnings: [] });
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language map migration refuses malformed or escaping legacy links", async () => {
    const projectRoot = await makeProject("runwield-domain-language-bad-map-");
    try {
        await Deno.writeTextFile(join(projectRoot, "CONTEXT-MAP.md"), "- [Bad](../CONTEXT.md)\n");
        const escaping = await migrateDomainLanguageArtifacts(projectRoot);
        assertEquals(escaping.warnings[0].code, "unsupported_map_link");
        assertEquals(await exists(join(projectRoot, "CONTEXT-MAP.md")), true);

        await Deno.writeTextFile(join(projectRoot, "CONTEXT-MAP.md"), "Legacy CONTEXT.md reference without a link\n");
        const malformed = await migrateDomainLanguageArtifacts(projectRoot);
        assertEquals(malformed.warnings[0].code, "unsupported_map_link");
        assertEquals(await exists(join(projectRoot, "CONTEXT-MAP.md")), true);
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language map migration protects lowercase glossary entries even when the map uses uppercase text", async () => {
    const projectRoot = await makeProject("runwield-domain-language-map-lowercase-");
    try {
        await Deno.mkdir(join(projectRoot, "one"), { recursive: true });
        await Deno.writeTextFile(join(projectRoot, "CONTEXT-MAP.md"), "- [One](./one/CONTEXT.md)\n");
        await Deno.writeTextFile(join(projectRoot, "one", "context.md"), "lower");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.notices, []);
        assertEquals(result.warnings[0].code, "source_missing");
        assertEquals(await exists(join(projectRoot, DOMAIN_LANGUAGE_PATHS.multiContextMap)), false);
        assertEquals(await Deno.readTextFile(join(projectRoot, "one", "context.md")), "lower");
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language map migration preflights all destinations before writing the canonical map", async () => {
    const projectRoot = await makeProject("runwield-domain-language-map-conflict-");
    try {
        await Deno.mkdir(join(projectRoot, "one"), { recursive: true });
        await Deno.mkdir(join(projectRoot, "docs"), { recursive: true });
        await Deno.writeTextFile(join(projectRoot, "CONTEXT-MAP.md"), "- [One](./one/CONTEXT.md)\n");
        await Deno.writeTextFile(join(projectRoot, "one", "CONTEXT.md"), "source");
        await Deno.writeTextFile(join(projectRoot, "one", "domain-language.md"), "existing");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.notices, []);
        assertEquals(result.warnings[0].code, "destination_conflict");
        assertEquals(await exists(join(projectRoot, DOMAIN_LANGUAGE_PATHS.multiContextMap)), false);
        assertEquals(await Deno.readTextFile(join(projectRoot, "one", "CONTEXT.md")), "source");
        assertEquals(await Deno.readTextFile(join(projectRoot, "one", "domain-language.md")), "existing");
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("domain-language migration keeps sources when filesystem installation fails", async () => {
    const projectRoot = await makeProject("runwield-domain-language-fs-fail-");
    try {
        await Deno.writeTextFile(join(projectRoot, "CONTEXT.md"), "source");
        await Deno.writeTextFile(join(projectRoot, "docs"), "not a directory");

        const result = await migrateDomainLanguageArtifacts(projectRoot);

        assertEquals(result.notices, []);
        assertEquals(result.warnings[0].code, "filesystem_error");
        assertEquals(await Deno.readTextFile(join(projectRoot, "CONTEXT.md")), "source");
        assertEquals(await Deno.readTextFile(join(projectRoot, "docs")), "not a directory");
    } finally {
        await cleanup(projectRoot);
    }
});

Deno.test("CLI startup reports domain-language migration on stderr without writing the notice to stdout", async () => {
    const projectRoot = await makeProject("runwield-domain-language-cli-");
    const homeDir = await makeProject("runwield-domain-language-home-");
    try {
        await Deno.writeTextFile(join(projectRoot, "CONTEXT.md"), "legacy");
        const command = new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", join(REPO_ROOT, "src", "cli.js"), "plans"],
            cwd: projectRoot,
            env: {
                HOME: homeDir,
                MNEMOSYNE_DB_PATH: join(homeDir, "m.db"),
            },
            stdout: "piped",
            stderr: "piped",
        });

        const output = await command.output();
        const stdout = new TextDecoder().decode(output.stdout);
        const stderr = new TextDecoder().decode(output.stderr);

        assertEquals(output.code, 0);
        assertEquals(stdout.includes("Migrated legacy domain language"), false);
        assertStringIncludes(stderr, "Migrated legacy domain language");
        assertEquals(await Deno.readTextFile(join(projectRoot, DOMAIN_LANGUAGE_PATHS.singleContext)), "legacy");
    } finally {
        await cleanup(projectRoot);
        await cleanup(homeDir);
    }
});

Deno.test("domain-language migration messages are suitable for stderr startup reporting", () => {
    const result = {
        notices: [{
            kind: "single-context" as const,
            message: "Migrated legacy domain language CONTEXT.md to docs/domain-language.md.",
            sourcePath: "/project/CONTEXT.md",
            destinationPath: "/project/docs/domain-language.md",
        }],
        warnings: [{
            kind: "single-context" as const,
            code: "destination_conflict" as const,
            message: "Canonical domain-language destination already exists.",
            sourcePath: "/project/CONTEXT.md",
            destinationPath: "/project/docs/domain-language.md",
        }],
    };

    assertEquals(formatDomainLanguageMigrationMessages(result), [
        "[RunWield] Migrated legacy domain language CONTEXT.md to docs/domain-language.md.",
        "[RunWield] Canonical domain-language destination already exists.",
    ]);
});
