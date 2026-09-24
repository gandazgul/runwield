import {
    RuntimeInteractionOutcomes,
    type RuntimeInteractionRequest,
    type RuntimeInteractionResponse,
    RuntimeInteractionTypes,
} from "../shared/session/session-runtime-interactions.js";

function displayLabel(label: string) {
    return label.replace(/\s*\(recommended\)$/i, "");
}

export function formatInterviewQuestion(interaction: RuntimeInteractionRequest) {
    const options = (interaction.options || []).map((option, index) => {
        const recommended = /\s*\(recommended\)$/i.test(option.label);
        return `${index + 1}. ${displayLabel(option.label)}${recommended ? " — recommended" : ""}`;
    });
    return [
        interaction.prompt,
        ...options,
        interaction.type === RuntimeInteractionTypes.SELECT
            ? "Reply with a number or write your answer."
            : "Write your answer.",
    ].join("\n\n");
}

export function parseInterviewReply(
    interaction: RuntimeInteractionRequest,
    text: string,
): RuntimeInteractionResponse | null {
    const trimmed = text.trim();
    if (!trimmed && !interaction.allowEmpty) return null;
    if (interaction.type === RuntimeInteractionTypes.TEXT) {
        return { outcome: RuntimeInteractionOutcomes.TEXT, value: interaction.allowEmpty ? text : trimmed };
    }
    const options = interaction.options || [];
    const number = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
    const matches = options.filter((option) => displayLabel(option.label).toLowerCase() === trimmed.toLowerCase());
    const option = number >= 1 && number <= options.length
        ? options[number - 1]
        : matches.length === 1
        ? matches[0]
        : null;
    if (option) {
        return {
            outcome: RuntimeInteractionOutcomes.SELECTED,
            value: option.value,
            valueLabel: option.label,
        };
    }
    return {
        outcome: RuntimeInteractionOutcomes.SELECTED,
        value: interaction.otherOptionValue || "other",
        valueLabel: "Other",
        otherText: trimmed,
    };
}
