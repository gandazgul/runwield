import { assertEquals, assertStringIncludes } from "@std/assert";
import { getCwd } from "../../../constants.js";
import { createMultiFileEditTool } from "../../../tools/multi_file_edit.ts";
import { buildBridgedToolPromptAppendix } from "./prompt.ts";

Deno.test("Antigravity prompt identifies native command and file creation tools", () => {
    const prompt = buildBridgedToolPromptAppendix([createMultiFileEditTool(getCwd())], "Antigravity CLI");
    assertStringIncludes(prompt, "run_command");
    assertStringIncludes(prompt, "write_to_file");
    assertStringIncludes(prompt, "bash");
    assertStringIncludes(prompt, "write");
    assertStringIncludes(prompt, "multi_file_edit only changes existing files");
});

Deno.test("Antigravity prompt adapts to read-only declared tools", () => {
    const prompt = buildBridgedToolPromptAppendix([], "Antigravity CLI", ["read", "code_search"]);
    assertStringIncludes(prompt, "view_file to read");
    assertEquals(prompt.includes("run_command"), false);
    assertEquals(prompt.includes("write_to_file"), false);
    assertEquals(prompt.includes("replace_file_content"), false);
});
