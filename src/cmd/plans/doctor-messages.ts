/** Plain user messages for Plans Doctor. */

export function doctorCleanMessage(repaired: number): string {
    if (repaired === 0) return "[RunWield] Your Plans look good.";
    return `[RunWield] Fixed ${repaired} safe Plan problem${repaired === 1 ? "" : "s"}. Your Plans look good now.`;
}

export function doctorNeedsHelpMessage(repaired: number, remaining: number): string {
    const fixed = repaired > 0 ? `Fixed ${repaired} safe problem${repaired === 1 ? "" : "s"}. ` : "";
    const left = remaining === 1 ? "1 problem needs" : `${remaining} problems need`;
    return `[RunWield] ${fixed}${left} your attention. Run wld plans doctor --check to see next steps.`;
}

export function doctorCheckMessage(issues: number): string {
    if (issues === 0) return "[RunWield] Your Plans look good. No files changed.";
    return `[RunWield] Found ${issues} thing${issues === 1 ? "" : "s"} to fix. No files changed.`;
}
