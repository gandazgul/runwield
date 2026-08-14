import { assertEquals } from "@std/assert";
import { Editor, TextDocument } from "@pierre/diffs/edit";

Deno.test("Workspace resolves the Pierre edit API required by Plannotator", () => {
    assertEquals(typeof Editor, "function");
    assertEquals(typeof TextDocument, "function");
});
