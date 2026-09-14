/** Shared select/text/approval question controls for Workspace-style browser surfaces. */

type SessionQuestionOption = {
    value: string;
    label: string;
    description?: string;
};

type SessionQuestionFormProps = {
    mode?: "select" | "text" | "approval" | string;
    state?: "pending" | "submitting" | "completed" | string;
    error?: string;
    prompt?: string;
    value?: string;
    placeholder?: string;
    allowEmpty?: boolean;
    action?: string;
    options?: SessionQuestionOption[];
};

function defaultOptions(mode: string): SessionQuestionOption[] {
    if (mode === "approval") return [{ value: "approve", label: "Approve" }, { value: "decline", label: "Decline" }];
    return [{ value: "guide", label: "Guide" }, { value: "planner", label: "Planner" }, {
        value: "engineer",
        label: "Engineer",
    }];
}

export function SessionQuestionForm(
    {
        mode = "select",
        state = "pending",
        error = "",
        prompt = "",
        value = "",
        placeholder = "",
        allowEmpty = false,
        action = "",
        options,
    }: SessionQuestionFormProps,
) {
    const isText = mode === "text";
    const isApproval = mode === "approval";
    const disabled = state === "submitting" || state === "completed";
    const title = prompt || (isText ? "Answer question" : isApproval ? "Approve?" : "Choose one");
    const choices = options?.length ? options : defaultOptions(mode);

    return (
        <form
            className="rw-question-card"
            aria-busy={state === "submitting" ? "true" : "false"}
            method="post"
            action={action}
        >
            <p className="kicker">RunWield question</p>
            <h1>{title}</h1>
            <p className="rw-question-help">Answer this browser question to continue the waiting command.</p>
            {error ? <p className="rw-question-error" role="alert">{error}</p> : null}
            {state === "completed"
                ? <p className="rw-question-complete">Answer saved. You can close this tab.</p>
                : null}
            {isText
                ? (
                    <label className="rw-question-field">
                        <span>Answer</span>
                        <textarea
                            name="answer"
                            required={!allowEmpty}
                            disabled={disabled}
                            placeholder={placeholder}
                            defaultValue={value}
                        />
                    </label>
                )
                : (
                    <fieldset className="rw-question-field" disabled={disabled}>
                        <legend>{isApproval ? "Decision" : "Choices"}</legend>
                        {choices.map((option) => (
                            <label className="rw-question-option" key={option.value}>
                                <input type="radio" name="answer" value={option.value} required />
                                <span>
                                    <strong>{option.label}</strong>
                                    {option.description ? <small>{option.description}</small> : null}
                                </span>
                            </label>
                        ))}
                    </fieldset>
                )}
            <div className="rw-question-actions">
                <button type="submit" className="rw-toolbar-button rw-toolbar-button-primary" disabled={disabled}>
                    {state === "submitting" ? "Submitting…" : "Submit answer"}
                </button>
                <button
                    type="submit"
                    name="cancel"
                    value="1"
                    formNoValidate
                    className="rw-toolbar-button"
                    disabled={disabled}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
