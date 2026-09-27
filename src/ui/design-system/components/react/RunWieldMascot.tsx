import { useEffect, useRef, useState } from "react";
import { mascotForAgent } from "../../../mascot/mascot.ts";
import type { Pose } from "../../../mascot/frames.ts";

export interface RunWieldMascotProps {
    agentName: string;
    parentAgentName?: string;
    pose?: Pose;
}

/** Decorative companion to the written agent identity and live activity label. */
export function RunWieldMascot({ agentName, parentAgentName, pose = "idle" }: RunWieldMascotProps) {
    const mascot = mascotForAgent(agentName, parentAgentName);
    const ref = useRef<SVGSVGElement>(null);
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        setFrame(0);
        const element = ref.current;
        if (!element || !mascot || pose !== "thinking") return;
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
        let visible = false;
        let index = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        function stop() {
            clearTimeout(timer);
            timer = undefined;
        }
        function tick() {
            index = (index + 1) % mascot!.frames.length;
            setFrame(index);
            timer = setTimeout(tick, mascot!.frames[index].duration);
        }
        function sync() {
            stop();
            index = 0;
            setFrame(0);
            if (visible && !document.hidden && !reducedMotion.matches) {
                timer = setTimeout(tick, mascot!.frames[0].duration);
            }
        }
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
        });
        observer.observe(element);
        document.addEventListener("visibilitychange", sync);
        reducedMotion.addEventListener("change", sync);
        return () => {
            stop();
            observer.disconnect();
            document.removeEventListener("visibilitychange", sync);
            reducedMotion.removeEventListener("change", sync);
        };
    }, [mascot, pose]);
    if (!mascot) return null;
    const path = pose === "thinking" ? mascot.frames[frame % mascot.frames.length].path : mascot[pose].path;
    return (
        <svg
            ref={ref}
            className="rw-agent-mascot"
            viewBox="0 0 20 18"
            width="60"
            height="54"
            shapeRendering="crispEdges"
            aria-hidden="true"
            focusable="false"
            data-agent-mascot={mascot.role}
            data-mascot-pose={pose}
        >
            <path d={path} />
        </svg>
    );
}
