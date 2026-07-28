import { assertEquals } from "@std/assert";
import {
    assertGoldenScenarioCoverage,
    collectGoldenScenarioCoverage,
    GOLDEN_TUI_REQUIRED_CAPABILITY_IDS,
} from "../testing/mod.js";
import { goldenTuiPortfolioScenarios } from "./catalog.js";

Deno.test("golden TUI portfolio declares asserted coverage for every required capability", () => {
    assertGoldenScenarioCoverage(goldenTuiPortfolioScenarios);
    const owners = collectGoldenScenarioCoverage(goldenTuiPortfolioScenarios);
    assertEquals(GOLDEN_TUI_REQUIRED_CAPABILITY_IDS.every((capability) => owners.has(capability)), true);
});
