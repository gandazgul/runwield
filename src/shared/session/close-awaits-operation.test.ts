import { assertEquals } from "@std/assert";

function methodBody(source: string, methodName: string): string {
    const start = source.indexOf(`${methodName}(`);
    if (start < 0) return "";
    const nextDoc = source.indexOf("\n    /**", start + methodName.length);
    return source.slice(start, nextDoc < 0 ? undefined : nextDoc);
}

Deno.test("closeSessionWhenIdle waits for the outer managed operation before disposal", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    const body = methodBody(source, "closeSessionWhenIdle");
    assertEquals(body.includes("#turnSettlements"), true);
    assertEquals(body.includes("#awaitManagedOperationSettlement(session.id)"), true);
    assertEquals(body.indexOf("#turnSettlements") < body.indexOf("#awaitManagedOperationSettlement(session.id)"), true);
    assertEquals(
        body.indexOf("#awaitManagedOperationSettlement(session.id)") < body.indexOf("return await this.closeSession"),
        true,
    );
});
