import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCompileArgs, resolvePlannotatorReviewEditorHtmlPath, selectStaticIncludeFlag } from "./compile.js";

Deno.test("selectStaticIncludeFlag prefers verbatim includes when supported", () => {
    assertEquals(selectStaticIncludeFlag("deno compile --include-as-is <path>"), "--include-as-is");
    assertEquals(selectStaticIncludeFlag("deno compile --include <path>"), "--include");
});

Deno.test("buildCompileArgs uses Deno compile flags and bundled resource includes", () => {
    const args = buildCompileArgs({
        staticIncludeFlag: "--include-as-is",
        reviewEditorHtmlPath: "/tmp/plannotator/review-editor.html",
    });

    assertEquals(args.slice(0, 9), [
        "compile",
        "-A",
        "--no-check",
        "--bundle",
        "--minify",
        "--app-name",
        "wld",
        "--include-as-is",
        "src/ui/workspace/static/",
    ]);
    assertEquals(args.includes("--output"), true);
    assertEquals(args.includes("./bin/wld"), true);
    assertEquals(args.at(-1), "src/cli.js");

    assertStringIncludes(args.join("\n"), "dist/workspace/");
    assertStringIncludes(args.join("\n"), "src/agent-definitions");
    assertStringIncludes(args.join("\n"), "src/prompt-templates");
    assertStringIncludes(args.join("\n"), "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md");
    assertStringIncludes(args.join("\n"), "src/skills");
    assertStringIncludes(args.join("\n"), "src/snip-filters");
    assertStringIncludes(args.join("\n"), "src/ui/theme/catppuccin-mocha.json");
    assertStringIncludes(args.join("\n"), "npm:@gandazgul/plannotator-pi-extension-compiled@^0.22.0/server");
    assertStringIncludes(args.join("\n"), "npm:@gandazgul/plannotator-pi-extension-compiled@^0.22.0/assets");
    assertStringIncludes(args.join("\n"), "/tmp/plannotator/review-editor.html");
});

Deno.test("buildCompileArgs falls back to regular includes for unsupported Deno versions", () => {
    const args = buildCompileArgs({
        staticIncludeFlag: "--include",
        reviewEditorHtmlPath: null,
    });

    assertEquals(args.includes("--include-as-is"), false);
    assertEquals(args.includes("--include"), true);
    assertEquals(args.includes("src/agent-definitions/workflow-prompts"), false);
});

Deno.test("Plannotator review editor package asset resolves to a readable HTML file", async () => {
    const path = resolvePlannotatorReviewEditorHtmlPath();
    const html = await Deno.readTextFile(path);

    assertStringIncludes(path, "review-editor.html");
    assertStringIncludes(html, "<!DOCTYPE html>");
});
