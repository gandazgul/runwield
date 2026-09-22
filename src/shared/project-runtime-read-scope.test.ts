import { assertEquals, assertNotStrictEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { defineCommittedGitFixture } from "./git-test-fixture.ts";
import {
    enterProjectRuntime,
    ProjectRuntimeEntryRefusedError,
    withProjectRuntimeReadScope,
} from "./project-runtime-layout.ts";

const fixture = defineCommittedGitFixture({ "README.md": "# Runtime read scope\n" });

Deno.test("runtime read scope shares checkout verification but rechecks changed evidence on the next read", async () => {
    const root = await fixture.checkout({ prefix: "runwield-runtime-read-scope-" });
    try {
        const layout = await withProjectRuntimeReadScope(async () => {
            const first = enterProjectRuntime(root);
            assertStrictEquals(enterProjectRuntime(root), first);
            const verified = await first;
            assertStrictEquals(await enterProjectRuntime(root), verified);
            return await withProjectRuntimeReadScope(() => enterProjectRuntime(root));
        });
        const marker = await Deno.readTextFile(layout.primary.layoutMarkerPath);
        await Deno.writeTextFile(layout.primary.layoutMarkerPath, "{invalid");
        await assertRejects(
            () => withProjectRuntimeReadScope(() => enterProjectRuntime(root)),
            ProjectRuntimeEntryRefusedError,
        );
        await Deno.writeTextFile(layout.primary.layoutMarkerPath, marker);
        const refreshed = await withProjectRuntimeReadScope(() => enterProjectRuntime(root));
        assertNotStrictEquals(refreshed, layout);
        assertEquals(refreshed.primary.checkoutRoot, layout.primary.checkoutRoot);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("runtime read scope verifies different checkouts independently", async () => {
    const first = await fixture.checkout({ prefix: "runwield-runtime-read-first-" });
    const second = await fixture.checkout({ prefix: "runwield-runtime-read-second-" });
    try {
        await withProjectRuntimeReadScope(async () => {
            const layouts = await Promise.all([enterProjectRuntime(first), enterProjectRuntime(second)]);
            assertNotStrictEquals(layouts[0], layouts[1]);
            assertEquals(layouts[0].primary.checkoutRoot, await Deno.realPath(first));
            assertEquals(layouts[1].primary.checkoutRoot, await Deno.realPath(second));
        });
    } finally {
        await Deno.remove(first, { recursive: true });
        await Deno.remove(second, { recursive: true });
    }
});
