/* Best-effort filtering of RunWield-owned shell starts. This is not a sandbox. */
export type BashAllowedCommands = readonly string[] | undefined;

interface Token {
    text: string;
    quoted: boolean;
}

function tokens(input: string): Token[] {
    const result: Token[] = [];
    let text = "";
    let quoted = false;
    let quote = "";
    let active = false;
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (quote) {
            if (char === quote) {
                quote = "";
                continue;
            }
            if (quote === '"' && (char === "$" || char === "`")) throw new Error("Shell expansion is not allowed");
            if (char === "\\" && quote === '"' && i + 1 < input.length) {
                const next = input[i + 1];
                if ('"\\$`'.includes(next)) {
                    text += next;
                    i++;
                    continue;
                }
            }
            text += char;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            quoted = true;
            active = true;
            continue;
        }
        if (char === "\\") {
            if (i + 1 >= input.length || input[i + 1] === "\n") throw new Error("Unsupported shell escape");
            text += input[++i];
            active = true;
            continue;
        }
        if (/\s/.test(char)) {
            if (char === "\n" || char === "\r") throw new Error("Only a single command is allowed");
            if (active) {
                result.push({ text, quoted });
                text = "";
                active = false;
                quoted = false;
            }
            continue;
        }
        if (";|&<>(){}$`".includes(char) || (char === "#" && !active)) {
            throw new Error("Only a single command without shell operators or expansion is allowed");
        }
        text += char;
        active = true;
    }
    if (quote) throw new Error("Unclosed shell quote");
    if (active) result.push({ text, quoted });
    return result;
}

function commandWords(input: string): string[] {
    const parsed = tokens(input.trim());
    if (!parsed.length) throw new Error("Command is empty");
    if (parsed[0].quoted || parsed[0].text.includes("/") || /^[A-Za-z_][A-Za-z_0-9]*=/.test(parsed[0].text)) {
        throw new Error("Executable paths, wrappers, and environment assignments are not allowed");
    }
    const words = parsed.map((token) => token.text);
    if (words[0] === "git") {
        let index = 1;
        while (words[index] === "--no-pager" || words[index] === "-C") {
            if (words[index] === "-C") {
                if (!words[index + 1] || words[index + 1].startsWith("-")) {
                    throw new Error("git -C requires a directory");
                }
                index += 2;
            } else index++;
        }
        if (!words[index] || words[index].startsWith("-")) throw new Error("Unsupported Git global option");
        return ["git", ...words.slice(index)];
    }
    return words;
}

export function normalizeBashAllowedCommands(value: string[] | null | undefined, source: string): BashAllowedCommands {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) throw new Error(`${source}: bashAllowedCommands must be a list or null`);
    return value.map((selector) => {
        if (typeof selector !== "string" || !selector.trim()) {
            throw new Error(`${source}: bashAllowedCommands contains an empty or non-string selector`);
        }
        try {
            const words = commandWords(selector);
            if (words.join(" ") !== selector.trim() || words.some((word) => /[*?\[\]]/.test(word))) {
                throw new Error("Selectors must be literal command tokens");
            }
        } catch (error) {
            throw new Error(
                `${source}: bashAllowedCommands: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return selector.trim();
    });
}

export function intersectBashAllowedCommands(
    parent: BashAllowedCommands,
    child: BashAllowedCommands,
): BashAllowedCommands {
    if (parent === undefined) return child;
    if (child === undefined) return parent;
    const intersection: string[] = [];
    for (const a of parent) {
        for (const b of child) {
            const left = a.split(" ");
            const right = b.split(" ");
            const shorter = left.length < right.length ? left : right;
            if (shorter.every((word, index) => word === left[index] && word === right[index])) {
                const specific = left.length > right.length ? a : b;
                if (!intersection.includes(specific)) intersection.push(specific);
            }
        }
    }
    return intersection;
}

export function describeBashAllowedCommands(allowed: BashAllowedCommands): string {
    if (allowed === undefined) return "";
    return `Only single inspection commands are allowed. Allowed commands: ${
        allowed.length ? allowed.join(", ") : "(none)"
    }. Use an allowed command. If you cannot complete the brief with these commands, report a blocker in your final handoff. Do not work around the restriction.`;
}

function deniedOption(words: string[]): string | undefined {
    const [exe, subcommand, ...args] = words;
    if (exe === "git") {
        if (args.some((arg) => /^(--output(?:=|$)|--ext-diff$|--textconv$)/.test(arg))) {
            return "Git output or external execution option";
        }
        if (
            subcommand === "grep" &&
            args.some((arg) => arg === "-O" || arg.startsWith("-O") || arg.startsWith("--open-files-in-pager"))
        ) return "Git pager execution option";
        if (
            subcommand === "branch" &&
            (!args.includes("--list") ||
                args.some((arg) => /^(-[dDmMcCf]|--(?:delete|move|copy|force|edit-description))/.test(arg)))
        ) return "Git branch must use --list without mutation options";
        if (subcommand === "remote" && (args[0] !== "-v" || args.length !== 1)) return "Git remote requires -v";
        if (subcommand === "worktree" && args[0] !== "list") return "Git worktree requires list";
    }
    if (
        exe === "find" &&
        words.slice(1).some((arg) => /^-(?:exec(?:dir)?|ok(?:dir)?|delete|fprint(?:0|f)?|fprintf|fls)$/.test(arg))
    ) return "Find execution or file mutation action";
    if (exe === "rg" && words.slice(1).some((arg) => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg))) {
        return "ripgrep external execution option";
    }
    if (exe === "file" && words.slice(1).some((arg) => arg === "-C" || arg.startsWith("--compile"))) {
        return "file compilation option";
    }
    return undefined;
}

export function checkBashCommand(command: string, allowed: BashAllowedCommands): void {
    if (allowed === undefined) return;
    try {
        const words = commandWords(command);
        const match = allowed.some((selector) => {
            const parts = selector.split(" ");
            return parts.every((word, index) => words[index] === word);
        });
        if (!match) throw new Error("Command is not in the allowed list");
        const option = deniedOption(words);
        if (option) throw new Error(option);
    } catch (error) {
        throw new Error(
            `${error instanceof Error ? error.message : String(error)}. ${describeBashAllowedCommands(allowed)}`,
        );
    }
}
