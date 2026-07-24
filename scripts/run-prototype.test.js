import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
    findTrackedPrototypeArtifacts,
    isSafePrototypeSlug,
    runPrototype,
    validatePrototypeSetup,
} from "./run-prototype.js";

async function makeGitFixture() {
    const dir = await Deno.makeTempDir();
    await new Deno.Command("git", { args: ["init"], cwd: dir, stdout: "null", stderr: "null" }).output();
    await Deno.writeTextFile(join(dir, ".gitignore"), "prototypes/\n");
    return dir;
}

/** @param {string} dir @param {string} slug @param {string} [task] */
async function makePrototype(dir, slug, task = "deno eval 'console.log(1)'") {
    const root = join(dir, "prototypes", slug);
    await Deno.mkdir(root, { recursive: true });
    await Deno.writeTextFile(join(root, "README.md"), `# ${slug}\n`);
    await Deno.writeTextFile(join(root, "deno.json"), JSON.stringify({ tasks: { dev: task } }, null, 4));
    return root;
}

Deno.test("prototype launcher accepts safe kebab-case slugs only", () => {
    assertEquals(isSafePrototypeSlug("plan-review-toolbar"), true);
    assertEquals(isSafePrototypeSlug("plan2-review"), true);
    assertEquals(isSafePrototypeSlug("PlanReview"), false);
    assertEquals(isSafePrototypeSlug("../escape"), false);
    assertEquals(isSafePrototypeSlug("plan--review"), false);
    assertEquals(isSafePrototypeSlug("plan_review"), false);
});

Deno.test("prototype setup requires ignored prototypes root, local deno config, and dev task", async () => {
    const dir = await makeGitFixture();
    try {
        await makePrototype(dir, "happy-path");
        const setup = await validatePrototypeSetup(dir, "happy-path");
        assertEquals(setup.relativeConfigPath, "prototypes/happy-path/deno.json");

        await Deno.mkdir(join(dir, "prototypes", "missing-dev"), { recursive: true });
        await Deno.writeTextFile(join(dir, "prototypes", "missing-dev", "deno.json"), JSON.stringify({ tasks: {} }));
        await assertRejects(
            () => validatePrototypeSetup(dir, "missing-dev"),
            Error,
            "must define a local tasks.dev command",
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("prototype setup fails when the root is not ignored", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await new Deno.Command("git", { args: ["init"], cwd: dir, stdout: "null", stderr: "null" }).output();
        await makePrototype(dir, "not-ignored");
        await assertRejects(
            () => validatePrototypeSetup(dir, "not-ignored"),
            Error,
            "must be gitignored",
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("prototype runner constructs a local deno dev task command with inherited I/O", async () => {
    const dir = await makeGitFixture();
    try {
        await makePrototype(dir, "command-check");
        /** @type {Array<{ command: string, options: Deno.CommandOptions }>} */
        const calls = [];
        const code = await runPrototype({
            cwd: dir,
            slug: "command-check",
            spawn: (command, options) => {
                calls.push({ command, options });
                return { status: Promise.resolve({ success: true, code: 0, signal: null }) };
            },
        });
        assertEquals(code, 0);
        assertEquals(calls.length, 1);
        assertEquals(calls[0].command, Deno.execPath());
        assertEquals(calls[0].options.args, ["task", "-c", "prototypes/command-check/deno.json", "dev"]);
        assertEquals(calls[0].options.stdin, "inherit");
        assertEquals(calls[0].options.stdout, "inherit");
        assertEquals(calls[0].options.stderr, "inherit");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("repository has no tracked executable prototype artifacts", async () => {
    assertEquals(await findTrackedPrototypeArtifacts({ cwd: Deno.cwd() }), []);
});

Deno.test("repository scan catches force-added ignored prototypes and production prototype markers", async () => {
    const dir = await makeGitFixture();
    try {
        const marker = ["THROWAWAY", "PROTOTYPE"].join(" ");
        await makePrototype(dir, "tracked-prototype");
        await Deno.mkdir(join(dir, "docs"), { recursive: true });
        await Deno.mkdir(join(dir, "scripts"), { recursive: true });
        await Deno.mkdir(join(dir, "src", "skills", "prototype"), { recursive: true });
        await Deno.mkdir(join(dir, "src", "ui", "__fixtures__"), { recursive: true });
        await Deno.writeTextFile(join(dir, "docs", "DesignPrototype.md"), "production docs are guarded\n");
        await Deno.writeTextFile(join(dir, "scripts", "foo.prototype.js"), "export const x = 1;\n");
        await Deno.writeTextFile(join(dir, "scripts", "foo.prototype.test.js"), `// ${marker}\n`);
        await Deno.writeTextFile(join(dir, "src", "skills", "prototype", "helper.js"), `// ${marker}\n`);
        await Deno.writeTextFile(join(dir, "src", "skills", "prototype", "README.md"), `${marker} docs\n`);
        await Deno.writeTextFile(join(dir, "src", "ui", "Widget.prototype.test.js"), "export const x = 1;\n");
        await Deno.writeTextFile(join(dir, "src", "ui", "WidgetPrototype.js"), "export const x = 1;\n");
        await Deno.writeTextFile(join(dir, "src", "ui", "marker.js"), `// ${marker}\n`);
        await Deno.writeTextFile(join(dir, "src", "ui", "__fixtures__", "FixturePrototype.js"), `// ${marker}\n`);
        await new Deno.Command("git", {
            args: [
                "add",
                "-f",
                "prototypes/tracked-prototype/README.md",
                "docs/DesignPrototype.md",
                "scripts/foo.prototype.js",
                "scripts/foo.prototype.test.js",
                "src/skills/prototype/helper.js",
                "src/skills/prototype/README.md",
                "src/ui/Widget.prototype.test.js",
                "src/ui/WidgetPrototype.js",
                "src/ui/marker.js",
                "src/ui/__fixtures__/FixturePrototype.js",
            ],
            cwd: dir,
            stdout: "null",
            stderr: "null",
        }).output();
        assertEquals(await findTrackedPrototypeArtifacts({ cwd: dir }), [
            "docs/DesignPrototype.md",
            "prototypes/tracked-prototype/README.md",
            "scripts/foo.prototype.js",
            "scripts/foo.prototype.test.js",
            "src/skills/prototype/helper.js",
            "src/ui/Widget.prototype.test.js",
            "src/ui/WidgetPrototype.js",
            "src/ui/marker.js",
        ]);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
