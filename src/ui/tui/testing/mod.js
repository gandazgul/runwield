export { GoldenScenarioActor } from "./scenario-actor.js";
export { assertEventIncludes, assertScreenIncludes, runGoldenScenario } from "./scenario-runner.js";
export { runGoldenChild, sanitizeGoldenChildEnv } from "./subprocess-runner.js";
export { createGoldenIsolatedEnvironment } from "./isolated-environment.js";
export { ScriptedReviewSurface } from "./scripted-review-surface.js";
export { normalizeScreenText, VirtualTerminal } from "./virtual-terminal.js";
export { runGoldenScenarioChildProcess } from "./child-protocol.js";
export {
    assertGoldenScenarioCoverage,
    collectGoldenScenarioCoverage,
    GOLDEN_TUI_REQUIRED_CAPABILITIES,
    GOLDEN_TUI_REQUIRED_CAPABILITY_IDS,
} from "./coverage-matrix.js";
export {
    assertCoverageWith,
    assertRuntimeEvent,
    assertsGoldenCoverage,
    assertStateStringIncludes,
    assertStateValue,
    assertVisibleText,
} from "./portfolio-assertions.js";
