/**
 * @module shared/ui/types
 */

/**
 * @typedef {{ appendText: (delta: string) => void }} AgentMessageAppender
 */

/**
 * @typedef {{
 *   appendOutput: (text: string) => void,
 *   endExecution: (isError: boolean, durationMs: number) => void,
 *   bodyText?: string,
 *   startTime: number,
 *   setExpanded?: (expanded: boolean) => void,
 * }} ToolExecutionBlockApi
 */

/**
 * @typedef {{ task: number, assignee: string, description: string }} RunningTask
 */

/**
 * @typedef {{ value: string, label: string, description?: string, [key: string]: unknown }} SelectOption
 */

/**
 * @typedef {{
 *   appendSystemMessage: (text: string, isError?: boolean) => void,
 *   appendAgentMessageStart: (agentName: string) => AgentMessageAppender,
 *   appendUserMessage?: (text: string) => void,
 *   appendImage?: (base64: string, mimeType: string) => void,
 *   requestRender: () => void,
 *   advanceSpinner?: () => void,
 *   setBusy?: (busy: boolean) => void,
 *   setRunningTasks?: (tasks: RunningTask[]) => void,
 *   clearMessages?: () => void,
 *   promptSelect: (title: string, options: SelectOption[]) => Promise<string | null>,
 *   promptText: (title: string, options?: { defaultValue?: string, placeholder?: string, allowEmpty?: boolean }) => Promise<string | null>,
 *   setAgentInfo?: (agentName: string, agentModel: string) => void,
 *   disableInput?: () => void,
 *   enableInput?: () => void,
 *   startToolExecution?: (id: string, name: string, argsStr: string) => ToolExecutionBlockApi,
 *   getActiveToolBlock?: (id: string) => ToolExecutionBlockApi | undefined,
 *   toggleToolOutputsExpanded?: () => void,
 *   addToolInvoked?: (event: import('@mariozechner/pi-coding-agent').SessionEvent) => void,
 *   addToolResult?: (event: import('@mariozechner/pi-coding-agent').SessionEvent) => void,
 *   isOutputSuppressed?: () => boolean,
 *   suppressOutput?: () => void,
 * }} UiAPI
 */

/**
 * @typedef {{
 *   disableSubmit: boolean,
 *   setText: (text: string) => void,
 *   setAutocompleteProvider: (provider: import('@mariozechner/pi-tui').AutocompleteProvider) => void,
 *   handleInput: (data: string) => void | Promise<void>,
 *   onSubmit?: (text: string) => void | Promise<void>,
 *   onChange?: (text: string) => void,
 *   onFocus?: () => void,
 *   onBlur?: () => void,
 *   addToHistory?: (text: string) => void,
 * }} EditorAPI
 */

/**
 * @typedef {{
 *   requestRender: () => void,
 *   setFocus: (component: import('@mariozechner/pi-tui').Component | null) => void,
 *   addChild?: (component: import('@mariozechner/pi-tui').Component) => void,
 * }} TuiAPI
 */
