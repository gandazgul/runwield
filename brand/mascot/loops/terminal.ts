import { AGENT_MASCOT_ALIASES, animations, mascotRoleForAgent, ROLES, terminalLines } from "./sprites.ts";

const requested = Deno.args.find((arg) => !arg.startsWith("--")) || "reviewer";
const parent = Deno.args.find((arg) => arg.startsWith("--parent="))?.slice("--parent=".length);
const animation = animations.find((item) => item.role === mascotRoleForAgent(requested, parent));
if (!animation) {
    console.error(
        requested === "delegated"
            ? "Delegated agents require --parent=<agent> so they can inherit its mascot."
            : `Choose a role: ${[...ROLES, ...Object.keys(AGENT_MASCOT_ALIASES)].join(", ")}`,
    );
    Deno.exit(1);
}
const encoder = new TextEncoder();
const write = (text: string) => Deno.stdout.writeSync(encoder.encode(text));
const snapshot = Deno.args.includes("--snapshot") || !Deno.stdout.isTerminal();
if (snapshot) {
    console.log(terminalLines(animation.frames[0].pixels).join("\n"));
    console.log(`${animation.role} · 20 columns × 9 rows`);
} else {
    const cyclesArg = Deno.args.find((arg) => arg.startsWith("--cycles="));
    const cycles = cyclesArg ? Math.max(1, Number(cyclesArg.split("=")[1]) || 1) : Infinity;
    let stopped = false;
    const stop = () => {
        stopped = true;
    };
    Deno.addSignalListener("SIGINT", stop);
    write("\x1b[?25l");
    try {
        for (let cycle = 0; cycle < cycles && !stopped; cycle++) {
            for (const frame of animation.frames) {
                if (stopped) break;
                write(terminalLines(frame.pixels).join("\n") + `\n${animation.role} · thinking (Ctrl+C to stop)\n`);
                await new Promise((resolve) => setTimeout(resolve, frame.duration));
                write("\x1b[10A\r");
            }
        }
        write(terminalLines(animation.idle).join("\n") + `\n\x1b[2K${animation.role} · idle\n`);
    } finally {
        Deno.removeSignalListener("SIGINT", stop);
        write("\x1b[?25h");
    }
}
