// @ts-nocheck: THROWAWAY PROTOTYPE — delete after choosing an execution-selection direction.
// Three variants of pre-approval execution selection, switchable via ?variant=A|B|C on /dev/plan-review.

import { useEffect, useState } from "react";
import "./execution-selection-prototype.css";

const PROTOTYPE_VARIANTS = [
    { id: "A", label: "Command bar" },
    { id: "B", label: "Launch dock" },
    { id: "C", label: "Execution card" },
];

const AGENT_LABELS = {
    "frontend-engineer": "Frontend Engineer",
    engineer: "Engineer",
};

const MODE_LABELS = {
    pair: "Pair Execution",
    autonomous: "Autonomous",
};

export function useExecutionSelectionPrototypeVariant(enabled) {
    const [variant, setVariant] = useState(() => enabled ? readVariant() : "A");

    useEffect(() => {
        if (!enabled) return undefined;

        function move(direction) {
            const currentIndex = PROTOTYPE_VARIANTS.findIndex((item) => item.id === variant);
            const nextIndex = (currentIndex + direction + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
            const nextVariant = PROTOTYPE_VARIANTS[nextIndex].id;
            const url = new URL(globalThis.location.href);
            url.searchParams.set("variant", nextVariant);
            globalThis.history.replaceState(globalThis.history.state, "", url);
            setVariant(nextVariant);
        }

        function handleKeyDown(event) {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) return;
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
        }

        globalThis.addEventListener("keydown", handleKeyDown);
        return () => globalThis.removeEventListener("keydown", handleKeyDown);
    }, [enabled, variant]);

    function selectVariant(nextVariant) {
        const url = new URL(globalThis.location.href);
        url.searchParams.set("variant", nextVariant);
        globalThis.history.replaceState(globalThis.history.state, "", url);
        setVariant(nextVariant);
    }

    return { variant, selectVariant };
}

export function ExecutionSelectionPrototype({
    placement,
    variant,
    executionAgent,
    collaborationMode,
    recommendedAgent,
    recommendedMode,
    onAgentChange,
    onModeChange,
    onApprove,
    onApproveLater,
    disabled,
    isLoading,
}) {
    if (placement === "toolbar" && variant === "A") {
        return (
            <section className="rw-execution-prototype-command" aria-label="Execution configuration">
                <CompactSelect
                    label="Agent"
                    value={executionAgent}
                    onChange={onAgentChange}
                    options={[
                        { value: "frontend-engineer", label: "Frontend Engineer" },
                        { value: "engineer", label: "Engineer" },
                    ]}
                />
                <CompactSelect
                    label="Style"
                    value={collaborationMode}
                    onChange={onModeChange}
                    options={[
                        {
                            value: "pair",
                            label: "Pair Execution",
                            disabled: executionAgent === "engineer",
                        },
                        { value: "autonomous", label: "Autonomous" },
                    ]}
                />
                <span
                    className="rw-execution-prototype-recommendation"
                    title={executionAgent === "engineer"
                        ? "Pair Execution is available only with Frontend Engineer"
                        : recommendationSentence(recommendedAgent, recommendedMode)}
                >
                    {executionAgent === "engineer"
                        ? "Pair is frontend-only · set to Autonomous"
                        : `Recommended: ${compactSummary(recommendedAgent, recommendedMode)}`}
                </span>
                <PrototypeApprovalActions
                    compact
                    executionAgent={executionAgent}
                    collaborationMode={collaborationMode}
                    onApprove={onApprove}
                    onApproveLater={onApproveLater}
                    disabled={disabled}
                    isLoading={isLoading}
                />
            </section>
        );
    }

    if (placement === "dock" && variant === "B") {
        return (
            <section className="rw-execution-prototype-dock" aria-labelledby="rw-launch-dock-title">
                <div className="rw-execution-prototype-handoff">
                    <span className="rw-execution-prototype-kicker">Ready to hand off</span>
                    <strong id="rw-launch-dock-title">
                        Launch with {agentLabel(executionAgent)} in {modeLabel(collaborationMode).toLowerCase()} mode.
                    </strong>
                    <span>
                        {executionAgent === "engineer"
                            ? "Pair Execution is frontend-only, so Engineer runs autonomously."
                            : recommendationSentence(recommendedAgent, recommendedMode)}
                    </span>
                </div>
                <div className="rw-execution-prototype-dock-controls">
                    <SegmentedChoice
                        label="Agent"
                        value={executionAgent}
                        onChange={onAgentChange}
                        options={[
                            { value: "frontend-engineer", label: "Frontend Engineer" },
                            { value: "engineer", label: "Engineer" },
                        ]}
                    />
                    <SegmentedChoice
                        label="Style"
                        value={collaborationMode}
                        onChange={onModeChange}
                        options={[
                            {
                                value: "pair",
                                label: "Pair Execution",
                                disabled: executionAgent === "engineer",
                            },
                            { value: "autonomous", label: "Autonomous" },
                        ]}
                    />
                </div>
                <PrototypeApprovalActions
                    executionAgent={executionAgent}
                    collaborationMode={collaborationMode}
                    onApprove={onApprove}
                    onApproveLater={onApproveLater}
                    disabled={disabled}
                    isLoading={isLoading}
                />
            </section>
        );
    }

    if (placement === "content" && variant === "C") {
        return (
            <section className="rw-execution-prototype-card" aria-labelledby="rw-execution-card-title">
                <header>
                    <div>
                        <span className="rw-execution-prototype-kicker">Before approval</span>
                        <h2 id="rw-execution-card-title">Configure execution</h2>
                        <p>Choose who runs this Plan and how closely you want to collaborate.</p>
                    </div>
                    <span className="rw-execution-prototype-plan-pick">
                        Plan recommends {compactSummary(recommendedAgent, recommendedMode)}
                    </span>
                </header>
                <div className="rw-execution-prototype-card-grid">
                    <LargeChoiceGroup
                        label="1. Execution Agent"
                        value={executionAgent}
                        onChange={onAgentChange}
                        options={[
                            {
                                value: "frontend-engineer",
                                label: "Frontend Engineer",
                                description: "UI-focused implementation with browser workflow expertise.",
                                recommended: recommendedAgent === "frontend-engineer",
                            },
                            {
                                value: "engineer",
                                label: "Engineer",
                                description: "General implementation without pair execution.",
                                recommended: recommendedAgent === "engineer",
                            },
                        ]}
                    />
                    <LargeChoiceGroup
                        label="2. Execution Style"
                        value={collaborationMode}
                        onChange={onModeChange}
                        options={[
                            {
                                value: "pair",
                                label: "Pair Execution",
                                description: "Stay involved for checkpoints and live course correction.",
                                disabled: executionAgent === "engineer",
                                disabledReason: "Frontend Engineer only",
                                recommended: recommendedMode === "pair",
                            },
                            {
                                value: "autonomous",
                                label: "Autonomous",
                                description: "Hand off the approved Plan and review the completed work.",
                                recommended: recommendedMode === "autonomous",
                            },
                        ]}
                    />
                </div>
                <footer>
                    <p>
                        <strong>Current launch:</strong> {agentLabel(executionAgent)} · {modeLabel(collaborationMode)}
                        {executionAgent === "engineer" && (
                            <span>Pair Execution is frontend-only, so Engineer always runs autonomously.</span>
                        )}
                    </p>
                    <PrototypeApprovalActions
                        executionAgent={executionAgent}
                        collaborationMode={collaborationMode}
                        onApprove={onApprove}
                        onApproveLater={onApproveLater}
                        disabled={disabled}
                        isLoading={isLoading}
                    />
                </footer>
            </section>
        );
    }

    return null;
}

export function ExecutionSelectionPrototypeSwitcher({ variant, onChange }) {
    const currentIndex = PROTOTYPE_VARIANTS.findIndex((item) => item.id === variant);
    const current = PROTOTYPE_VARIANTS[currentIndex] || PROTOTYPE_VARIANTS[0];

    function move(direction) {
        const nextIndex = (currentIndex + direction + PROTOTYPE_VARIANTS.length) % PROTOTYPE_VARIANTS.length;
        onChange(PROTOTYPE_VARIANTS[nextIndex].id);
    }

    return (
        <nav className="rw-execution-prototype-switcher" aria-label="Execution selection prototype variants">
            <button type="button" onClick={() => move(-1)} aria-label="Previous prototype variant">←</button>
            <span>
                <strong>{current.id}</strong> — {current.label}
            </span>
            <button type="button" onClick={() => move(1)} aria-label="Next prototype variant">→</button>
        </nav>
    );
}

function CompactSelect({ label, value, onChange, options }) {
    return (
        <label className="rw-execution-prototype-select">
            <span>{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
                ))}
            </select>
        </label>
    );
}

function SegmentedChoice({ label, value, onChange, options }) {
    return (
        <fieldset className="rw-execution-prototype-segmented">
            <legend>{label}</legend>
            <div>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={value === option.value ? "active" : ""}
                        aria-pressed={value === option.value}
                        disabled={option.disabled}
                        onClick={() => onChange(option.value)}
                        title={option.disabled ? "Pair Execution is available only with Frontend Engineer" : undefined}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

function LargeChoiceGroup({ label, value, onChange, options }) {
    return (
        <fieldset className="rw-execution-prototype-large-choice">
            <legend>{label}</legend>
            <div>
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={value === option.value ? "active" : ""}
                        aria-pressed={value === option.value}
                        disabled={option.disabled}
                        onClick={() => onChange(option.value)}
                    >
                        <span>
                            <strong>{option.label}</strong>
                            {option.recommended && <em>Recommended</em>}
                        </span>
                        <small>{option.disabled ? option.disabledReason : option.description}</small>
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

function PrototypeApprovalActions({
    compact = false,
    executionAgent,
    collaborationMode,
    onApprove,
    onApproveLater,
    disabled,
    isLoading,
}) {
    return (
        <div className={`rw-execution-prototype-approval${compact ? " compact" : ""}`}>
            {!compact && <span>Approving: {compactSummary(executionAgent, collaborationMode)}</span>}
            <div>
                <button className="secondary" type="button" onClick={onApproveLater} disabled={disabled}>
                    Approve for Later
                </button>
                <button className="primary" type="button" onClick={onApprove} disabled={disabled}>
                    {isLoading
                        ? "Approving…"
                        : compact
                        ? `Approve · ${compactSummary(executionAgent, collaborationMode)}`
                        : "Approve & Run"}
                </button>
            </div>
        </div>
    );
}

function readVariant() {
    if (!globalThis.location) return "A";
    const requested = new URLSearchParams(globalThis.location.search).get("variant")?.toUpperCase();
    return PROTOTYPE_VARIANTS.some((item) => item.id === requested) ? requested : "A";
}

function agentLabel(agent) {
    return AGENT_LABELS[agent] || agent;
}

function modeLabel(mode) {
    return MODE_LABELS[mode] || mode;
}

function compactSummary(agent, mode) {
    return `${agentLabel(agent)} · ${modeLabel(mode)}`;
}

function recommendationSentence(agent, mode) {
    return `The Plan recommends ${agentLabel(agent)} with ${modeLabel(mode)}.`;
}
