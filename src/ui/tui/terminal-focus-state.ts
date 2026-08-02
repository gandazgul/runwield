const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

export type TerminalFocusState = "unknown" | "focused" | "unfocused";

type TerminalInputHandler = (data: string) => void;
type TerminalResizeHandler = (size: { columns: number; rows: number }) => void;

export interface FocusReportingTerminal {
    write(data: string): void;
    start(onInput: TerminalInputHandler, onResize?: TerminalResizeHandler): void;
}

export interface TerminalFocusStateOwner {
    getState(): TerminalFocusState;
    filterInput(data: string): string;
    dispose(): void;
}

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
    let disposed = false;
    terminal.write(ENABLE_FOCUS_REPORTING);

    const owner = {
        getState(): TerminalFocusState {
            return state;
        },
        filterInput(data: string): string {
            const { filtered, nextState } = filterFocusReportInput(data, state);
            state = nextState;
            return filtered;
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
    const owner = createTerminalFocusStateOwner(terminal);
    const originalStart = terminal.start.bind(terminal);
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
): { filtered: string; nextState: TerminalFocusState } {
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
        filtered += data[index];
        index += 1;
    }
    return { filtered, nextState };
}
