import { mascotForAgent } from "../mascot/mascot.ts";
import type { Pose } from "../mascot/frames.ts";

export interface TuiMascotState {
    agentName: string;
    parentAgentName?: string;
    sessionId: string;
    pose: Pose;
}

/** Owns only its frame clock; transcript components retain their render caches. */
export class TuiAgentMascot {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private key = "";
    private frame = 0;
    private disposed = false;

    constructor(private readonly requestRender: () => void) {}

    render(width: number, compact: boolean, state: TuiMascotState): string[] {
        const mascot = mascotForAgent(state.agentName, state.parentAgentName);
        const key = `${state.sessionId}:${mascot?.role}:${state.pose}:${compact}:${width > 0}`;
        if (key !== this.key) {
            this.stop();
            this.key = key;
            this.frame = 0;
        }
        if (!mascot || width < 8 || this.disposed) return [];
        const animate = state.pose === "thinking" && !compact;
        if (animate && this.timer === undefined) {
            this.timer = setTimeout(() => {
                this.timer = undefined;
                this.frame = (this.frame + 1) % mascot.frames.length;
                this.requestRender();
            }, mascot.frames[this.frame].duration);
        }
        const lines = compact
            ? ["▛▀▀▀▀▀▜", "▙ ▪ ▪ ▟"]
            : state.pose === "thinking"
            ? mascot.frames[this.frame].lines
            : mascot[state.pose].lines;
        return lines.map((line) => " ".repeat(Math.max(0, width - line.length)) + line);
    }

    private stop() {
        clearTimeout(this.timer);
        this.timer = undefined;
    }

    dispose() {
        this.disposed = true;
        this.stop();
    }
}
