import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCompileArgs, resolvePlannotatorReviewEditorHtmlPath } from "./compile.js";

Deno.test("buildCompileArgs uses Deno compile flags and bundled resource includes", () => {
    const args = buildCompileArgs({
        reviewEditorHtmlPath: "/tmp/plannotator/review-editor.html",
    });

    assertEquals(args.slice(0, 17), [
        "compile",
        "--output",
        "./bin/wld",
        "-A",
        "--no-check",
        "--unstable-no-legacy-abort",
        "--reload",
        "--exclude-unused-npm",
        "--self-extracting",
        "--app-name",
        "wld",
        "--include",
        "src/ui/workspace/static/",
        "--include",
        "src/ui/design-system/tokens.css",
        "--include",
        "src/ui/design-system/components.css",
    ]);
    assertEquals(args.includes("--bundle"), false);
    assertEquals(args.includes("--minify"), false);
    assertEquals(args.includes("--output"), true);
    assertEquals(args.includes("./bin/wld"), true);
    assertEquals(args.at(-1), "src/cli.js");
    assertEquals(args.includes("--include-as-is"), false);

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

Deno.test("buildCompileArgs keeps resource includes before the script", () => {
    const args = buildCompileArgs({
        reviewEditorHtmlPath: null,
    });

    assertEquals(args.at(-1), "src/cli.js");
    assertEquals(args.includes("src/agent-definitions/workflow-prompts"), false);
});

Deno.test("Plannotator review editor package asset resolves to a readable HTML file", async () => {
    const path = resolvePlannotatorReviewEditorHtmlPath();
    const html = await Deno.readTextFile(path);

    assertStringIncludes(path, "review-editor.html");
    assertStringIncludes(html, "<!DOCTYPE html>");
});
