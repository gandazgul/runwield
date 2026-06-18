import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { applyAttentionNudge, getGlobalAgentMdPaths, readGlobalAgentMd } from "./session.js";

Deno.test("readGlobalAgentMd falls back from ~/.hns/HARNS.md to ~/.hns/AGENTS.md", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "harns-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".hns"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".hns", "AGENTS.md"), "Global AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome);

        assertEquals(prompt, "Global AGENTS fallback");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("readGlobalAgentMd falls back to ~/.agents/AGENTS.md by default", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "harns-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".agents"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".agents", "AGENTS.md"), "External AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome);

        assertEquals(prompt, "External AGENTS fallback");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("readGlobalAgentMd can disable ~/.agents/AGENTS.md fallback", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "harns-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".agents"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".agents", "AGENTS.md"), "External AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome, { includeExternal: false });

        assertEquals(prompt, "");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("getGlobalAgentMdPaths stays inside ~/.hns", () => {
    assertEquals(getGlobalAgentMdPaths("/tmp/home", { includeExternal: false }), [
        "/tmp/home/.hns/HARNS.md",
        "/tmp/home/.hns/AGENTS.md",
    ]);
});

Deno.test("getGlobalAgentMdPaths includes shared ~/.agents/AGENTS.md when enabled", () => {
    assertEquals(getGlobalAgentMdPaths("/tmp/home", { includeExternal: true }), [
        "/tmp/home/.hns/HARNS.md",
        "/tmp/home/.hns/AGENTS.md",
        "/tmp/home/.agents/AGENTS.md",
    ]);
});

Deno.test("applyAttentionNudge only injects scheduled long-lived agent nudges", () => {
    assertEquals(applyAttentionNudge(AGENTS.IDEATOR, "User asks", 1), "User asks");
    assertEquals(applyAttentionNudge(AGENTS.OPERATOR, "User asks", 6), "User asks");

    assertEquals(
        applyAttentionNudge(AGENTS.GUIDE, "User asks", 6),
        [
            "<attention_nudge>",
            "You are still the Guide. Stay read-only, answer direct questions concisely, and return to Router if the user asks for edits, plans, execution, or deeper ideation.",
            "</attention_nudge>",
            "",
            "User asks",
        ].join("\n"),
    );

    assertEquals(
        applyAttentionNudge(AGENTS.IDEATOR, "User asks", 6),
        [
            "<attention_nudge>",
            "You are still the Ideator. Continue as a thinking partner: clarify one decision at a time, verify external facts when needed, and use `return_to_router` for actionable implementation or planning requests.",
            "</attention_nudge>",
            "",
            "User asks",
        ].join("\n"),
    );
});
