import { animations, mascotRoleForAgent, type Pose, svgPath, terminalLines } from "./frames.ts";

/** Precomputed once, shared by both renderers. No pixel work during animation. */
export const MASCOTS = animations.map((animation) => ({
    role: animation.role,
    drawingWidth: Math.max(
        ...[...animation.frames.map((frame) => frame.pixels), animation.idle, animation.answering]
            .flatMap((pixels) => terminalLines(pixels).map((line) => line.trimEnd().length)),
    ),
    frames: animation.frames.map((frame) => ({
        duration: frame.duration,
        path: svgPath(frame.pixels),
        lines: terminalLines(frame.pixels),
    })),
    idle: { path: svgPath(animation.idle), lines: terminalLines(animation.idle) },
    answering: { path: svgPath(animation.answering), lines: terminalLines(animation.answering) },
}));

export function mascotForAgent(agentName: string, parentAgentName?: string) {
    const role = mascotRoleForAgent(agentName, parentAgentName);
    return MASCOTS.find((mascot) => mascot.role === role);
}

export interface MascotActivity {
    busy: boolean;
    waiting?: boolean;
    answering?: boolean;
}

export function mascotPose(activity: MascotActivity): Pose {
    if (!activity.busy || activity.waiting) return "idle";
    return activity.answering ? "answering" : "thinking";
}
