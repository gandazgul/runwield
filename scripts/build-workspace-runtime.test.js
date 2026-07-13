import { assertEquals } from "@std/assert";
import { getOpaqueWorkspaceAssetName } from "./build-workspace-runtime.js";

Deno.test("getOpaqueWorkspaceAssetName hides executable browser modules from compile graph tracing", () => {
    assertEquals(getOpaqueWorkspaceAssetName("client.js"), "client.js.asset");
    assertEquals(getOpaqueWorkspaceAssetName("worker.mjs"), "worker.mjs.asset");
    assertEquals(getOpaqueWorkspaceAssetName("styles.css"), "styles.css");
    assertEquals(getOpaqueWorkspaceAssetName("sprite.png"), "sprite.png");
});
