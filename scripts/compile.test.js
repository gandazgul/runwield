import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { assertCompileDenoVersion, buildCompileArgs, DENO_COMPILE_VERSION, parseCompileOptions } from "./compile.js";

Deno.test("buildCompileArgs uses Deno compile flags and bundled resource includes", () => {
    const args = buildCompileArgs();

    assertEquals(args.slice(0, 17), [
        "compile",
        "--output",
        "./bin/wld",
        "-A",
        "--no-check",
        "--unstable-no-legacy-abort",
        "--exclude-unused-npm",
        "--bundle",
        "--minify",
        "--app-name",
        "wld",
        "--include",
        "src/ui/workspace/static/",
        "--include",
        "src/ui/design-system/tokens.css",
        "--include",
        "src/ui/design-system/components.css",
    ]);
    assertEquals(args.includes("--reload"), false);
    assertEquals(args.includes("--bundle"), true);
    assertEquals(args.includes("--minify"), true);
    assertEquals(args.includes("--self-extracting"), false);
    assertEquals(args.includes("--output"), true);
    assertEquals(args.includes("./bin/wld"), true);
    assertEquals(args.at(-1), "src/cli.js");
    assertEquals(args.includes("--include-as-is"), false);

    assertStringIncludes(args.join("\n"), "dist/workspace-runtime/server.mjs");
    assertStringIncludes(args.join("\n"), "dist/workspace-runtime/client/");
    assertStringIncludes(args.join("\n"), "src/ui/workspace/server/plan-adapter.js");
    assertEquals(args.join("\n").includes("dist/workspace/"), false);
    assertStringIncludes(args.join("\n"), "src/agent-definitions");
    assertStringIncludes(args.join("\n"), "src/prompt-templates");
    assertStringIncludes(args.join("\n"), "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md");
    assertStringIncludes(args.join("\n"), "src/skills");
    assertStringIncludes(args.join("\n"), "src/snip-filters");
    assertStringIncludes(args.join("\n"), "src/ui/theme/catppuccin-mocha.json");
    assertEquals(args.some((arg) => arg.includes("plannotator-pi-extension-compiled")), false);
});

Deno.test("buildCompileArgs keeps resource includes before the script", () => {
    const args = buildCompileArgs();

    assertEquals(args.at(-1), "src/cli.js");
    assertEquals(args.includes("src/agent-definitions/workflow-prompts"), false);
});

Deno.test("buildCompileArgs accepts release target, output, and reload overrides", () => {
    const args = buildCompileArgs({
        output: "wld.exe",
        target: "x86_64-pc-windows-msvc",
        reload: true,
    });

    assertEquals(args.slice(0, 3), ["compile", "--output", "wld.exe"]);
    assertEquals(args.includes("--reload"), true);
    assertEquals(args.includes("x86_64-pc-windows-msvc"), true);
    assertEquals(args.indexOf("--target") < args.indexOf("--include"), true);
});

Deno.test("parseCompileOptions supports separated and equals forms", () => {
    assertEquals(parseCompileOptions(["--reload", "--output", "wld", "--target=aarch64-apple-darwin"]), {
        reload: true,
        output: "wld",
        target: "aarch64-apple-darwin",
    });
    assertThrows(() => parseCompileOptions(["--target"]), Error, "requires a value");
    assertThrows(() => parseCompileOptions(["--wat"]), Error, "Unknown compile option");
});

Deno.test("standalone compiler version is pinned", () => {
    assertCompileDenoVersion(DENO_COMPILE_VERSION);
    assertThrows(() => assertCompileDenoVersion("2.8.0"), Error, DENO_COMPILE_VERSION);
});
