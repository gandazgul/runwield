import { assert, assertStringIncludes } from "@std/assert";

Deno.test("preparation failure leaves the planning segment current", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assertStringIncludes(source, "prepareSegmentHandoff: true");
    assertStringIncludes(source, "await this.rollManagedSessionSegment");
    assert(source.indexOf("prepareSegmentHandoff: true") < source.indexOf("await this.rollManagedSessionSegment"));
});

Deno.test("committed execution marker resumes in the same successor without a duplicate seed turn", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assertStringIncludes(source, "resolvePendingSegmentHandoff");
    assertStringIncludes(source, "resumeExecutionSegmentHandoff");
});

Deno.test("execution seed excludes Planner history and carries approval images", async () => {
    const runner = await Deno.readTextFile(new URL("../workflow/engineer-runner.ts", import.meta.url));
    assertStringIncludes(runner, "runEngineerWithSegmentHandoff");
    assertStringIncludes(runner, "images: continuation.approval?.images");
    assert(
        !runner.includes("routerMessage") ||
            runner.indexOf("runEngineerWithSegmentHandoff") > runner.lastIndexOf("routerMessage"),
    );
});
