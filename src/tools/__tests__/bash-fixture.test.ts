import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRunWieldBashToolDefinition } from "../bash.ts";

Deno.test("restricted Pi bash inspects real staged and unstaged Git state without starting denied writes", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-bash-git-inspection-" });
    try {
        const git = async (...args: string[]) => {
            const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
            if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
        };
        await git("init", "-b", "main");
        await Deno.writeTextFile(join(cwd, "file with spaces.txt"), "original marker\n");
        await git("add", ".");
        await git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "history marker");
        await Deno.writeTextFile(join(cwd, "file with spaces.txt"), "staged marker\n");
        await git("add", ".");
        await Deno.writeTextFile(join(cwd, "file with spaces.txt"), "staged marker\nunstaged marker\n");
        const fixture = join(cwd, "keep.txt");
        await Deno.writeTextFile(fixture, "keep me\n");
        const sentinel = join(cwd, "sentinel.txt");
        const policy = [
            "git status",
            "git diff",
            "git log",
            "git show",
            "git branch --list",
            "git remote -v",
            "git worktree list",
            "ls",
            "cat",
            "find",
        ];
        const tool = createRunWieldBashToolDefinition(cwd, policy);
        const execute = async (command: string) => {
            const result = await tool.execute(
                "call",
                { command },
                new AbortController().signal,
                () => {},
                { sessionManager: SessionManager.inMemory(cwd) } as never,
            );
            return result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
        };
        assertStringIncludes(await execute("git log -1 --oneline"), "history marker");
        assertStringIncludes(await execute("git show HEAD:'file with spaces.txt'"), "original marker");
        assertStringIncludes(await execute("git diff --cached"), "staged marker");
        assertStringIncludes(await execute("git diff"), "unstaged marker");
        assertStringIncludes(await execute("git status --short"), "file with spaces.txt");
        assertStringIncludes(await execute("git -C '" + cwd + "' --no-pager log -1"), "history marker");
        assertStringIncludes(await execute("git branch --list"), "main");
        assertStringIncludes(await execute("git worktree list"), "main");
        assertStringIncludes(await execute("ls 'file with spaces.txt'"), "file with spaces.txt");
        assertStringIncludes(await execute("cat 'file with spaces.txt'"), "unstaged marker");
        for (
            const command of [
                "git branch unwanted",
                "git add keep.txt",
                "git diff --output=" + sentinel,
                "find . -delete",
                "find . -exec touch sentinel.txt \\;",
                "ls > " + sentinel,
                "git status && touch " + sentinel,
            ]
        ) {
            await assertRejects(() => execute(command), Error, "Allowed commands:");
        }
        assertEquals(await Deno.stat(fixture).then(() => true, () => false), true);
        assertEquals(await Deno.stat(sentinel).then(() => true, () => false), false);
        assertStringIncludes(await execute("git branch --list unwanted"), "(no output)");
        assertStringIncludes(await execute("git diff --cached"), "staged marker");
        assertStringIncludes(await execute("git status --short"), "keep.txt");
        // An approved command still reports Pi's real process error outside a repository.
        const outside = await Deno.makeTempDir({ prefix: "runwield-bash-outside-git-" });
        try {
            const outsideTool = createRunWieldBashToolDefinition(outside, ["git status"]);
            const error = await assertRejects(
                () =>
                    outsideTool.execute(
                        "call",
                        { command: "git status" },
                        new AbortController().signal,
                        () => {},
                        { sessionManager: SessionManager.inMemory(outside) } as never,
                    ),
                Error,
                "not a git repository",
            );
            assertEquals(error.message.includes("Allowed commands:"), false);
        } finally {
            await Deno.remove(outside, { recursive: true });
        }
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
