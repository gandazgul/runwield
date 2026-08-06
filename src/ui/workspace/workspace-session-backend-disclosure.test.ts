// @ts-nocheck: Astro workspace check uses browser tsconfig without Deno/JSR test globals.
import { assertEquals, assertStringIncludes } from "@std/assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveSessionModelDisclosure, SessionBackendDisclosure } from "./islands/SessionSurface.jsx";

Deno.test("^Workspace Session disclosure distinguishes Claude CLI from Pi$", () => {
    const claudeHtml = renderToStaticMarkup(
        React.createElement(SessionBackendDisclosure, { snapshot: { model: "sonnet", provider: "claude-cli" } }),
    );
    assertStringIncludes(claudeHtml, "claude-cli/sonnet");
    assertStringIncludes(claudeHtml, "Claude CLI");
    assertStringIncludes(claudeHtml, "Claude Code owns its internal file/Bash/tool activity");
    assertStringIncludes(claudeHtml, "not native RunWield tool-event history");

    const piHtml = renderToStaticMarkup(
        React.createElement(SessionBackendDisclosure, {
            snapshot: { model: "fixture-model", provider: "runtime-command-fixture" },
        }),
    );
    assertStringIncludes(piHtml, "runtime-command-fixture/fixture-model");
    assertEquals(piHtml.includes("Claude Code owns"), false);

    const missingHtml = renderToStaticMarkup(
        React.createElement(SessionBackendDisclosure, { snapshot: {} }),
    );
    assertStringIncludes(missingHtml, "Model not recorded");
    assertStringIncludes(missingHtml, "Execution Backend not recorded");
    assertEquals(missingHtml.includes("undefined"), false);
});

Deno.test("Workspace Session disclosure derives read-only metadata from committed snapshot values", () => {
    assertEquals(deriveSessionModelDisclosure({ model: "opus", provider: "claude-cli" }), {
        reference: "claude-cli/opus",
        backendLabel: "Claude CLI",
        showClaudeCaveat: true,
    });
    assertEquals(deriveSessionModelDisclosure({ model: "gpt-5", provider: "openai" }), {
        reference: "openai/gpt-5",
        backendLabel: "openai",
        showClaudeCaveat: false,
    });
    assertEquals(deriveSessionModelDisclosure(null), {
        reference: "Model not recorded",
        backendLabel: "Execution Backend not recorded",
        showClaudeCaveat: false,
    });
});
