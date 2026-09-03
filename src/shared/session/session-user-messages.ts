export type SessionOwnerKind = "workspace" | "tui" | "acp" | "unknown";

function ownerLocation(kind?: SessionOwnerKind): string {
    switch (kind) {
        case "tui":
            return "another terminal";
        case "workspace":
            return "RunWield Workspace";
        case "acp":
            return "another connected app";
        default:
            return "another RunWield window";
    }
}

export function buildActiveConversationSubmissionMessage(kind?: SessionOwnerKind): string {
    return `This conversation is still running in ${
        ownerLocation(kind)
    }. Continue there, or wait for its current turn to finish before sending here.`;
}

export function buildActiveConversationStatusMessage(kind?: SessionOwnerKind): string {
    return `This conversation is running in ${
        ownerLocation(kind)
    }. Messages sent here will queue until its current turn finishes.`;
}

export function buildConversationRestoredMessage(kind?: SessionOwnerKind): string {
    if (!kind) return "Conversation restored.";
    return `Conversation restored in read-only mode because it is still running in ${
        ownerLocation(kind)
    }. Continue there, or wait for its current turn to finish; this screen will become available automatically.`;
}
