import { assertEquals } from "@std/assert";
import { runOnboardCommand } from "./index.ts";

Deno.test("wld onboard refuses a non-interactive terminal without starting a Session", async () => {
    let started = false;
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
        await runOnboardCommand([], {
            sessionPort: {
                startInteractiveSession: () => {
                    started = true;
                    return Promise.resolve();
                },
            },
        });
    } finally {
        console.error = originalError;
    }

    assertEquals(started, false);
    assertEquals(errors, ["[RunWield] wld onboard requires an interactive terminal."]);
});

Deno.test("slash onboarding delegates to the active TUI flow", async () => {
    let calls = 0;
    await runOnboardCommand([], {
        uiAPI: {} as never,
        beginOnboarding: () => {
            calls += 1;
            return Promise.resolve();
        },
        sessionPort: {
            startInteractiveSession: () => Promise.reject(new Error("must not start another TUI")),
        },
    });
    assertEquals(calls, 1);
});
