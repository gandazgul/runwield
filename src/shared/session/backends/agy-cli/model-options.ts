/** Keep supervising-model selection identical for chat and image generation. */
export function thinkingLevelToEffort(modelId: string, thinkingLevel: string | undefined): "low" | "medium" | "high" {
    switch (thinkingLevel || "off") {
        case "off":
        case "minimal":
        case "low":
            return "low";
        case "medium":
            return modelId === "gemini-3.1-pro" ? "high" : "medium";
        case "high":
        case "xhigh":
        case "max":
            return "high";
        default:
            throw new Error(`Unknown RunWield thinkingLevel "${thinkingLevel}".`);
    }
}

export function concreteAgyModel(modelId: string, effort: "low" | "medium" | "high"): string {
    return `${modelId}-${effort}`;
}
