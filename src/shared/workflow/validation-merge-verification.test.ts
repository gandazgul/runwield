import { assertEquals } from "@std/assert";
import { createGitPort } from "../git-port.ts";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { verifyPostMergeCandidatePublished } from "./validation-merge-verification.ts";

const fixture = defineCommittedGitFixture({ "file.txt": "base\n" });

Deno.test("publication proof requires the exact candidate and metadata commits", async () => {
    const root = await fixture.checkout();
    try {
        await git(root, ["switch", "-c", "runwield/worktree/demo"]);
        await Deno.writeTextFile(`${root}/file.txt`, "work\n");
        await git(root, ["add", "file.txt"]);
        await git(root, ["commit", "-m", "candidate"]);
        const candidate = await git(root, ["rev-parse", "HEAD"]);
        await Deno.writeTextFile(`${root}/plan.txt`, "verified\n");
        await git(root, ["add", "plan.txt"]);
        await git(root, ["commit", "-m", "metadata"]);
        const metadata = await git(root, ["rev-parse", "HEAD"]);
        await git(root, ["switch", "main"]);
        await git(root, ["merge", "--ff-only", "runwield/worktree/demo"]);

        const proven = await verifyPostMergeCandidatePublished({
            projectRoot: root,
            worktreeBranch: "runwield/worktree/demo",
            worktreeBaseBranch: "main",
            git: createGitPort(),
            executionCommit: candidate,
            metadataCommit: metadata,
            targetBranch: "main",
        });
        assertEquals(proven.merged, true);

        await git(root, ["switch", "-c", "not-published", `${candidate}^`]);
        await Deno.writeTextFile(`${root}/lost.txt`, "lost\n");
        await git(root, ["add", "lost.txt"]);
        await git(root, ["commit", "-m", "not published"]);
        const missing = await git(root, ["rev-parse", "HEAD"]);
        const rejected = await verifyPostMergeCandidatePublished({
            projectRoot: root,
            worktreeBranch: "not-published",
            worktreeBaseBranch: "main",
            git: createGitPort(),
            executionCommit: missing,
            targetBranch: "main",
        });
        assertEquals(rejected.merged, false);
    } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
});
