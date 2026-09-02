import { assertEquals, assertFalse } from "@std/assert";
import { escapeReviewPayloadJson } from "./review-payload-json.ts";

Deno.test("embedded review JSON cannot close its script element", () => {
    const payload = {
        rawPatch: "const closingTag = '</script>';\n<div>source text, not page content</div>&",
    };
    const encoded = escapeReviewPayloadJson(JSON.stringify(payload));

    assertFalse(encoded.includes("</script>"));
    assertFalse(encoded.includes("<div>"));
    assertEquals(JSON.parse(encoded), payload);
});
