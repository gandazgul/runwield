const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

export type TerminalFocusState = "unknown" | "focused" | "unfocused";

export type TerminalSize = {
    columns: number;
    rows: number;
};

export type TerminalInputHandler = (data: string) => void;
export type TerminalResizeHandler = (size: TerminalSize) => void;

export interface FocusReportingTerminal {
    write(data: string): void;
    start(onInput: TerminalInputHandler, onResize?: TerminalResizeHandler): void;
}

export interface TerminalFocusStateOwner {
    getState(): TerminalFocusState;
    filterInput(data: string): string;
    dispose(): void;
}

type FocusFilterResult = {
    filtered: string;
    pending: string;
    nextState: TerminalFocusState;
};

let currentTerminalFocusState: TerminalFocusStateOwner | null = null;

export function getCurrentTerminalFocusState(): TerminalFocusState {
    return currentTerminalFocusState?.getState() ?? "unknown";
}

export function setCurrentTerminalFocusState(owner: TerminalFocusStateOwner | null): void {
    currentTerminalFocusState = owner;
}

export function createTerminalFocusStateOwner(
    terminal: Pick<FocusReportingTerminal, "write">,
): TerminalFocusStateOwner {
    let state: TerminalFocusState = "unknown";
    let pendingInput = "";
    let disposed = false;
    terminal.write(ENABLE_FOCUS_REPORTING);

    const owner = {
        getState(): TerminalFocusState {
            return state;
        },
        filterInput(data: string): string {
            const result = filterFocusReportInput(pendingInput + data, state);
            pendingInput = result.pending;
            state = result.nextState;
            return result.filtered;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            terminal.write(DISABLE_FOCUS_REPORTING);
            if (currentTerminalFocusState === owner) {
                currentTerminalFocusState = null;
            }
        },
    } satisfies TerminalFocusStateOwner;

    return owner;
}

export function installTerminalFocusState(terminal: FocusReportingTerminal): TerminalFocusStateOwner {
    const originalStart = terminal.start.bind(terminal);
    const owner = createTerminalFocusStateOwner(terminal);
    terminal.start = (onInput: TerminalInputHandler, onResize?: TerminalResizeHandler): void => {
        originalStart((data: string) => {
            const filtered = owner.filterInput(data);
            if (filtered.length > 0) onInput(filtered);
        }, onResize);
    };
    setCurrentTerminalFocusState(owner);
    return owner;
}

function filterFocusReportInput(
    data: string,
    initialState: TerminalFocusState,
): FocusFilterResult {
    let nextState = initialState;
    let filtered = "";
    for (let index = 0; index < data.length;) {
        if (data.startsWith(FOCUS_IN, index)) {
            nextState = "focused";
            index += FOCUS_IN.length;
            continue;
        }
        if (data.startsWith(FOCUS_OUT, index)) {
            nextState = "unfocused";
            index += FOCUS_OUT.length;
            continue;
        }
        const rest = data.slice(index);
        if (isPartialFocusReport(rest)) {
            return { filtered, pending: rest, nextState };
        }
        filtered += data[index];
        index += 1;
    }
    return { filtered, pending: "", nextState };
}

function isPartialFocusReport(data: string): boolean {
    return data.length > 1 && (FOCUS_IN.startsWith(data) || FOCUS_OUT.startsWith(data));
}
