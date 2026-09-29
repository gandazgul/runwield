import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createRunWieldBashToolDefinition } from "../bash.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";

Deno.test("restricted Pi bash executes inspection and rejects mutations before shell launch", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-bash-policy-" });
    try {
        const git = async (args: string[]) => {
            const result = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
            if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
        };
        await git(["init", "-b", "main"]);
        await git([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "inspection marker",
        ]);
        await Deno.writeTextFile(join(cwd, "file with spaces.txt"), "inspection content\n");
        await git(["add", "file with spaces.txt"]);
        await git([
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "tracked inspection content",
        ]);
        await Deno.writeTextFile(join(cwd, "file with spaces.txt"), "inspection content\nunstaged marker\n");
        await Deno.writeTextFile(join(cwd, "staged.txt"), "staged marker\n");
        await git(["add", "staged.txt"]);
        const tool = createRunWieldBashToolDefinition(cwd, [
            "git status",
            "git diff",
            "git log",
            "git show",
            "git branch --list",
            "git remote -v",
            "git worktree list",
            "cat",
            "ls",
        ]);
        const execute = (command: string) =>
            tool.execute(
                "call",
                { command },
                new AbortController().signal,
                () => {},
                { sessionManager: SessionManager.inMemory(cwd) } as never,
            );
        const log = await execute("git log -2 --oneline");
        assertStringIncludes(
            log.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"),
            "inspection marker",
        );
        for (
            const [command, marker] of [
                ["git show HEAD:'file with spaces.txt'", "inspection content"],
                ["git diff -- 'file with spaces.txt'", "unstaged marker"],
                ["git diff --cached -- staged.txt", "staged marker"],
                ["git -C . status --short", "staged.txt"],
                ["git branch --list", "main"],
                ["git worktree list", "main"],
                ["ls", "file with spaces.txt"],
            ]
        ) {
            const result = await execute(command);
            assertStringIncludes(
                result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"),
                marker,
            );
        }
        await execute("git remote -v");
        const cat = await execute("cat 'file with spaces.txt'");
        assertStringIncludes(
            cat.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"),
            "inspection content",
        );
        const status = await execute("git status --short");
        assertStringIncludes(
            status.content.filter((item) => item.type === "text").map((item) => item.text).join("\n"),
            "file with spaces.txt",
        );
        const denied = await assertRejects(() => execute("git status && touch sentinel"), Error, "report a blocker");
        assertStringIncludes(denied.message, "git status");
        await assertRejects(() => execute("ls > sentinel"), Error, "single inspection commands");
        await assertRejects(() => execute("git branch unwanted"), Error, "Allowed commands");
        await assertRejects(() => execute("git add ."), Error, "Allowed commands");
        await assertRejects(() => execute("git diff --output=sentinel"), Error, "Git output");
        await assertRejects(() => execute("find . -delete"), Error, "Allowed commands");
        await assertRejects(() => execute("find . -exec touch sentinel \\;"), Error, "Allowed commands");
        assertEquals((await Deno.readTextFile(join(cwd, "file with spaces.txt"))).includes("unstaged marker"), true);
        const index = await new Deno.Command("git", { cwd, args: ["diff", "--cached", "--name-only"], stdout: "piped" })
            .output();
        assertEquals(new TextDecoder().decode(index.stdout).trim(), "staged.txt");
        assertEquals(await Deno.stat(join(cwd, "sentinel")).then(() => true, () => false), false);
        assertEquals(
            await new Deno.Command("git", { cwd, args: ["branch", "--list", "unwanted"], stdout: "piped" }).output()
                .then((result) => new TextDecoder().decode(result.stdout).trim()),
            "",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("empty policy denies all while absent policy retains Pi shell", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-bash-policy-empty-" });
    try {
        const empty = createRunWieldBashToolDefinition(cwd, []);
        await assertRejects(
            () =>
                empty.execute(
                    "call",
                    { command: "pwd" },
                    new AbortController().signal,
                    () => {},
                    { sessionManager: SessionManager.inMemory(cwd) } as never,
                ),
            Error,
            "(none)",
        );
        const unrestricted = createRunWieldBashToolDefinition(cwd);
        await unrestricted.execute(
            "call",
            { command: "touch unrestricted-file" },
            new AbortController().signal,
            () => {},
            { sessionManager: SessionManager.inMemory(cwd) } as never,
        );
        assertEquals((await Deno.stat(join(cwd, "unrestricted-file"))).isFile, true);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
