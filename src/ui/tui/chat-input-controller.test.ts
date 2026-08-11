import { assertStringIncludes } from "@std/assert";

Deno.test("chat input controller owns local command precedence", async () => {
    const source = await Deno.readTextFile(new URL("./chat-input-controller.ts", import.meta.url));
    assertStringIncludes(source, 'if (userRequest.startsWith("!"))');
    assertStringIncludes(source, "handleBashCommand");
});

Deno.test("chat input controller owns streaming slash block message", async () => {
    const source = await Deno.readTextFile(new URL("./chat-input-controller.ts", import.meta.url));
    assertStringIncludes(source, "That slash command can only run after streaming has stopped.");
});
