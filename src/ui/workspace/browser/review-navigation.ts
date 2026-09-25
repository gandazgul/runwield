/** Keep reloaded reviews attached to the latest question from the same operation. */
export function updateReviewInteractionUrl(interactionId: string): void {
    const nextUrl = new URL(globalThis.location.href);
    nextUrl.searchParams.set("interaction", interactionId);
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
}
