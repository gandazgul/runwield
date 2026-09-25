import { exerciseProof } from "./model-proof-fixture.ts";

Deno.test("LIVE proof refuses a reply that omits the tool result", () => exerciseProof(false));
