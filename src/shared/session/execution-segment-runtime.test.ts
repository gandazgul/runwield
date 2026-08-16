import { assert, assertStringIncludes } from "@std/assert";

Deno.test("preparation failure leaves the planning segment current", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assertStringIncludes(source, "prepareSegmentHandoff: true");
    assertStringIncludes(source, "await this.rollManagedSessionSegment");
    assert(source.indexOf("prepareSegmentHandoff: true") < source.indexOf("await this.rollManagedSessionSegment"));
});

Deno.test("execution handoff revalidates the approved Plan snapshot before preparation", async () => {
    const source = await Deno.readTextFile(new URL("../workflow/plan-executor.ts", import.meta.url));
    assertStringIncludes(source, "validateApprovedPlanSnapshotForHandoff");
    assertStringIncludes(source, "Plan revision changed after approval");
    assertStringIncludes(source, "Plan status changed after approval");
    assertStringIncludes(source, "Managed execution handoff requires complete approval-time Plan action evidence");
    assertStringIncludes(source, "normalizeApprovalSnapshotForHandoff(approvalTriageMeta)");
    assert(!source.includes("approvalTriageMeta: _triageMeta || effectiveMeta"));
    assert(
        source.indexOf("const approvalValidation") <
            source.indexOf("executionContext = await startActiveExecutionWorkflow"),
    );
});

Deno.test("committed execution marker resumes in the same successor without a duplicate seed turn", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assertStringIncludes(source, "resolvePendingSegmentHandoff");
    assertStringIncludes(source, "executePreparedPlanSegmentHandoff");
});

Deno.test("legacy Session load acquires its writer lock before opening Pi", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    const loadStart = source.indexOf("async loadSession(options)");
    const loadEnd = source.indexOf("\n    setInteractionAdapter(", loadStart);
    const loadSource = source.slice(loadStart, loadEnd);
    assert(loadStart >= 0 && loadEnd > loadStart);
    assert(
        loadSource.indexOf("ownerCoordinationStore.acquireSessionActivation") <
            loadSource.indexOf("await openPersistedRootSession"),
    );
});

Deno.test("managed operations rely on the OS lock without a heartbeat timer", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assert(!source.includes("setInterval(heartbeat"));
    assert(!source.includes("heartbeatFailureReason"));
});

Deno.test("semantic repair rolls managed Sessions and continues uncataloged Sessions", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    assert(!source.includes("if (!managed) return validationResult"));
    assertStringIncludes(source, "runwieldSessionId: managed?.runwieldSessionId || session.id");
    assertStringIncludes(source, "if (managed) {");
    assert(!source.includes("Semantic repair handoff requires a segmented Session."));
    assertStringIncludes(source, 'kind: "semantic_repair"');
    assertStringIncludes(source, "return await this.#runSemanticRepairContinuation");
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
