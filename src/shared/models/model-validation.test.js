import { assertEquals } from "@std/assert";
import { parseProviderModel } from "./model-validation.js";
import { resolveTemplateModel } from "../interactive/chat-session.js";

Deno.test("parseProviderModel accepts strict provider/id", () => {
    const parsed = parseProviderModel("openai/gpt-4.1");
    assertEquals(parsed, { ok: true, provider: "openai", id: "gpt-4.1" });
});

Deno.test("parseProviderModel rejects non provider/id formats", () => {
    assertEquals(parseProviderModel("gpt-4.1"), { ok: false });
    assertEquals(parseProviderModel("openai/"), { ok: false });
    assertEquals(parseProviderModel("/gpt-4.1"), { ok: false });
});

Deno.test("resolveTemplateModel returns ok for valid configured model", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: (/** @type {string} */ provider, /** @type {string} */ model) => ({ provider, id: model }),
        hasConfiguredAuth: () => true,
    });

    assertEquals(result, { ok: true, provider: "openai", id: "gpt-4.1" });
});

Deno.test("resolveTemplateModel fails for unknown model", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: () => null,
        hasConfiguredAuth: () => true,
    });

    assertEquals(result, { ok: false });
});

Deno.test("resolveTemplateModel fails when auth is missing", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: (/** @type {string} */ provider, /** @type {string} */ model) => ({ provider, id: model }),
        hasConfiguredAuth: () => false,
    });

    assertEquals(result, { ok: false });
});
