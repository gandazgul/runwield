import { exerciseProof } from "./model-proof-fixture.ts";

Deno.test("LIVE proof confirms a remote sentinel through a model reply", () => exerciseProof(true));
