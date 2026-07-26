import {
    buildLargeDiffReviewPrompt,
    createReviewDiffTool,
    formatChangedFileList,
    getFileDiff,
    listDiffFiles,
    parseDiffFiles,
} from "./review-diff-tool.js";
import { assertEquals, assertStringIncludes } from "@std/assert";

import { __resetSettingsForTests } from "../settings.js";

const SAMPLE_INLINE_DIFF = `diff --git a/src/a.js b/src/a.js
index 1111111..2222222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,2 @@
-old line
+new line
 context

diff --git a/src/b.js b/src/b.js
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/b.js
@@ -0,0 +1,2 @@
+added line
+another added line

diff --git a/src/c.js b/src/c.js
deleted file mode 100644
index 4444444..0000000
--- a/src/c.js
+++ /dev/null
@@ -1,2 +0,0 @@
-deleted line
-another deleted line

diff --git a/src/old.js b/src/new.js
similarity index 88%
rename from src/old.js
rename to src/new.js
index 5555555..6666666 100644
--- a/src/old.js
+++ b/src/new.js
@@ -1 +1 @@
-old name
+new name

diff --git a/src/binary.png b/src/binary.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/src/binary.png differ
`;

Deno.test("parseDiffFiles parses modified, added, deleted, renamed, and binary files", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    assertEquals(entries.length, 5, "expected 5 file entries");

    const modEntry = entries.find((e) => e.path === "src/a.js");
    assertEquals(modEntry?.changeType, "modified");
    assertEquals(modEntry?.hunkLines.added, 1);
    assertEquals(modEntry?.hunkLines.removed, 1);

    const addEntry = entries.find((e) => e.path === "src/b.js");
    assertEquals(addEntry?.changeType, "added");
    assertEquals(addEntry?.hunkLines.added, 2);
    assertEquals(addEntry?.hunkLines.removed, 0);

    const delEntry = entries.find((e) => e.path === "src/c.js");
    assertEquals(delEntry?.changeType, "deleted");
    assertEquals(delEntry?.hunkLines.added, 0);
    assertEquals(delEntry?.hunkLines.removed, 2);

    const renameEntry = entries.find((e) => e.path === "src/new.js");
    assertEquals(renameEntry?.changeType, "renamed");

    const binaryEntry = entries.find((e) => e.path === "src/binary.png");
    assertEquals(binaryEntry?.changeType, "modified");
    assertEquals(binaryEntry?.hunkLines.added, 0);
    assertEquals(binaryEntry?.hunkLines.removed, 0);
});

Deno.test("parseDiffFiles returns empty array for empty diff", () => {
    assertEquals(parseDiffFiles(""), []);
    assertEquals(parseDiffFiles("   "), []);
    assertEquals(parseDiffFiles("no header here"), []);
});

Deno.test("formatChangedFileList includes all entries with summary info", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const output = formatChangedFileList(entries);
    assertStringIncludes(output, "src/a.js");
    assertStringIncludes(output, "src/b.js");
    assertStringIncludes(output, "src/c.js");
    assertStringIncludes(output, "1 added, 1 removed");
    assertStringIncludes(output, "2 added, 0 removed");
    assertStringIncludes(output, "0 added, 2 removed");
    assertStringIncludes(output, "5 file(s)");
});

Deno.test("getFileDiff finds file by exact path", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/a.js");
    assertEquals(result.found, true);
    if (result.found) {
        assertStringIncludes(result.content, "new line");
        assertEquals(result.truncated, false);
    }
});

Deno.test("getFileDiff returns not-found for nonexistent file", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/nope.js");
    assertEquals(result.found, false);
    if (!result.found) {
        assertStringIncludes(result.message, "not found");
    }
});

Deno.test("getFileDiff supports byte offset for truncated reads", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    // Use a very small maxBytes to force truncation
    const result = getFileDiff(entries, "src/a.js", { offsetBytes: 0, maxBytes: 50 });
    assertEquals(result.found, true);
    if (result.found) {
        assertEquals(result.truncated, true);
        assertEquals(result.remainingBytes > 0, true);
    }
});

Deno.test("listDiffFiles marks entries exceeding max inline bytes as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 1);

    for (const s of summaries) {
        assertEquals(s.truncated, true);
        assertEquals(s.maxInlineBytes, 1);
    }
});

Deno.test("listDiffFiles does not mark small entries as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 10_000_000);

    for (const s of summaries) {
        assertEquals(s.truncated, false);
        assertEquals(s.maxInlineBytes, null);
    }
});

Deno.test("buildLargeDiffReviewPrompt produces compact review packet without full diff", () => {
    const reviewerAgentDef = {
        name: "reviewer",
        displayName: "Reviewer",
        model: "",
        description: "",
        tools: [],
        systemPrompt: "",
    };
    const planContent = "Add a feature that does X.";
    const totalBytes = new TextEncoder().encode(SAMPLE_INLINE_DIFF).byteLength;
    const prompt = buildLargeDiffReviewPrompt(reviewerAgentDef, planContent, SAMPLE_INLINE_DIFF, totalBytes);

    // Should NOT contain the full diff
    assertEquals(prompt.includes("new line"), false);
    assertEquals(prompt.includes("brand new"), false);
    assertEquals(prompt.includes("removed line1"), false);

    // Should contain the changed file listing
    assertStringIncludes(prompt, "src/a.js");
    assertStringIncludes(prompt, "src/b.js");
    assertStringIncludes(prompt, "src/c.js");

    // Should contain the original plan
    assertStringIncludes(prompt, "Add a feature that does X");

    // Should contain usage instructions
    assertStringIncludes(prompt, "review_diff");

    // Should mention the size
    assertStringIncludes(prompt, "omitted");
});

Deno.test("review_diff tool responds to list command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-1", { command: "list" });
    assertStringIncludes(result.content[0].text, "src/a.js");
    assertStringIncludes(result.content[0].text, "src/b.js");
    assertEquals(result.details.command, "list");
    assertEquals(result.details.fileCount, 5);
});

Deno.test("review_diff tool responds to show command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-2", { command: "show", path: "src/a.js" });
    assertStringIncludes(result.content[0].text, "new line");
    assertEquals(result.details.command, "show");
    assertEquals(result.details.path, "src/a.js");
});

Deno.test("review_diff tool reports error for missing path in show", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-3", { command: "show" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "required");
});

Deno.test("review_diff tool reports error for unknown command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-4", { command: "unknown" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "unknown command");
});

Deno.test("review_diff tool reports not-found for nonexistent file", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-5", { command: "show", path: "nonexistent.js" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "not found");
});

Deno.test("review_diff tool returns no-files message for empty diff", async () => {
    const tool = createReviewDiffTool("");
    const result = await /** @type {any} */ (tool.execute)("test-6", { command: "list" });
    assertEquals(result.details.fileCount, 0);
    assertStringIncludes(result.content[0].text, "No changed files");
});

// ─── Large-diff / error-handling integration tests ──────────────────────────
