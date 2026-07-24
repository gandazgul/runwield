// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useMemo, useRef, useState } from "react";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider.tsx";
import { Tooltip, TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { Viewer } from "@plannotator/ui/components/Viewer.tsx";
import { MarkdownEditor } from "@plannotator/ui/components/MarkdownEditor.tsx";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel.tsx";
import { AnnotationToolstrip } from "@plannotator/ui/components/AnnotationToolstrip.tsx";
import { FeedbackButton } from "@plannotator/ui/components/ToolbarButtons.tsx";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";
import { ActionMenu, ActionMenuItem } from "@plannotator/ui/components/ActionMenu.tsx";
import { Button } from "@plannotator/ui/components/ui/button.tsx";
import { OverlayScrollArea } from "@plannotator/ui/components/OverlayScrollArea.tsx";
import { ResizeHandle } from "@plannotator/ui/components/ResizeHandle.tsx";
import { SidebarContainer } from "@plannotator/ui/components/sidebar/SidebarContainer.tsx";
import { SidebarTabs } from "@plannotator/ui/components/sidebar/SidebarTabs.tsx";
import { ScrollViewportContext } from "@plannotator/ui/hooks/useScrollViewport.ts";
import { usePrintMode } from "@plannotator/ui/hooks/usePrintMode.ts";
import { useConfigValue } from "@plannotator/ui/config/index.ts";
import { getPlanSaveSettings } from "@plannotator/ui/utils/planSave.ts";
import { exportAnnotations, extractFrontmatter, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser.ts";
import { getUIPreferences, PLAN_WIDTH_OPTIONS } from "@plannotator/ui/utils/uiPreferences.ts";
import { PlanReviewSettings } from "./PlanReviewSettings.tsx";
import {
    PLAN_APPROVAL_ACTIONS,
    primaryPlanApprovalActionForClassification,
} from "../../../shared/workflow/plan-approval.js";
import "./plannotator.css";

const DEFAULT_PLAN_PAYLOAD = { plan: "", token: "", mode: "dev" };

export function PlanReviewSurface({ payload }) {
    usePrintMode();
    const initialPayload = useMemo(() => payload || readEmbeddedPayload("review-payload") || DEFAULT_PLAN_PAYLOAD, [
        payload,
    ]);
    const [plan, setPlan] = useState(initialPayload.plan || "");
    const [draftPlan, setDraftPlan] = useState(initialPayload.plan || "");
    const [editorMode, setEditorMode] = useState("view");
    const [uiPreferences, setUiPreferences] = useState(() => getUIPreferences());
    const [sidebarOpen, setSidebarOpen] = useState(() => getUIPreferences().tocEnabled);
    const [annotationsOpen, setAnnotationsOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [annotations, setAnnotations] = useState([]);
    const [globalAttachments, setGlobalAttachments] = useState([]);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const [annotationMode, setAnnotationMode] = useState("selection");
    const [inputMethod, setInputMethod] = useState("drag");
    const [scrollViewport, setScrollViewport] = useState(null);
    const [submitting, setSubmitting] = useState(null);
    const [submitted, setSubmitted] = useState(null);
    const [error, setError] = useState("");
    const editorHandleRef = useRef(null);
    const viewerHandleRef = useRef(null);
    const gridEnabled = useConfigValue("gridEnabled");
    const editorDirty = draftPlan !== plan;
    const planMaxWidth = useMemo(
        () => PLAN_WIDTH_OPTIONS.find((option) => option.id === uiPreferences.planWidth)?.px || 832,
        [uiPreferences.planWidth],
    );
    const parsed = useMemo(() => {
        const frontmatterResult = extractFrontmatter(plan);
        return {
            blocks: parseMarkdownToBlocks(plan),
            frontmatter: frontmatterResult.frontmatter,
        };
    }, [plan]);
    const trustedPolicy = readInitialExecutionPolicy(initialPayload, parsed.frontmatter);
    const planClassification = trustedPolicy.classification;
    const showExecutionPolicyControls = trustedPolicy.canSelectExecutionPolicy;
    const primaryApprovalAction = primaryPlanApprovalActionForClassification(planClassification);
    const [executionAgent, setExecutionAgent] = useState(trustedPolicy.executionAgent);
    const [collaborationRecommendation, setCollaborationRecommendation] = useState(
        trustedPolicy.collaborationRecommendation,
    );

    async function submitApprove(approvalAction) {
        setSubmitting("approve");
        try {
            await submit("decision", {
                approved: true,
                approvalAction,
                ...buildApprovalPolicyPayload(),
                ...buildReviewPayload(),
                ...buildPlanSavePayload(),
            });
            setSubmitted("approved");
        } catch {
            // submit() owns the visible error state.
        } finally {
            setSubmitting(null);
        }
    }

    async function submitFeedback() {
        setSubmitting("feedback");
        try {
            await submit("deny", {
                ...buildReviewPayload(),
                ...buildPlanSavePayload(),
            });
            setSubmitted("feedback");
        } catch {
            // submit() owns the visible error state.
        } finally {
            setSubmitting(null);
        }
    }

    function selectExecutionAgent(nextAgent) {
        setExecutionAgent(nextAgent);
        if (nextAgent === "engineer") setCollaborationRecommendation("autonomous");
    }

    function selectCollaborationRecommendation(nextRecommendation) {
        if (nextRecommendation === "pair" && executionAgent !== "frontend-engineer") return;
        setCollaborationRecommendation(nextRecommendation);
    }

    function addAnnotation(annotation) {
        const next = {
            ...annotation,
            id: annotation.id || crypto.randomUUID(),
            type: annotation.type || "COMMENT",
            createdA: annotation.createdA || Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(next.id);
    }

    function removeAnnotation(id) {
        viewerHandleRef.current?.removeHighlight?.(id);
        setAnnotations((items) => items.filter((item) => item.id !== id));
        setSelectedAnnotationId((selectedId) => selectedId === id ? null : selectedId);
    }

    function toggleCheckbox(blockId, checked) {
        const block = parsed.blocks.find((item) => item.id === blockId);
        if (!block || typeof block.startLine !== "number") return;
        const nextPlan = toggleMarkdownCheckbox(plan, block.startLine, checked);
        setPlan(nextPlan);
        if (!editorDirty) setDraftPlan(nextPlan);
    }

    function saveEditor() {
        const nextPlan = editorHandleRef.current?.getMarkdown?.() ?? draftPlan;
        setPlan(nextPlan);
        setDraftPlan(nextPlan);
        setEditorMode("view");
    }

    function applyUIPreferences(next) {
        setUiPreferences((current) => {
            if (current.tocEnabled !== next.tocEnabled) setSidebarOpen(next.tocEnabled);
            return next;
        });
    }

    function currentPlan() {
        return editorMode === "edit" ? editorHandleRef.current?.getMarkdown?.() ?? draftPlan : plan;
    }

    function buildReviewPayload() {
        const hasAnnotations = annotations.length > 0 || globalAttachments.length > 0;
        return {
            ...(hasAnnotations && {
                feedback: exportAnnotations(parsed.blocks, annotations, globalAttachments),
            }),
            annotations,
            globalAttachments,
        };
    }

    function buildApprovalPolicyPayload() {
        if (!showExecutionPolicyControls) return {};
        return {
            executionAgent,
            collaborationRecommendation,
        };
    }

    function buildPlanSavePayload() {
        const planSaveSettings = getPlanSaveSettings();
        return {
            plan: currentPlan(),
            planSave: {
                enabled: planSaveSettings.enabled,
                path: initialPayload.planPath,
                ...(planSaveSettings.customPath && { customPath: planSaveSettings.customPath }),
            },
        };
    }

    // Plannotator supplies behavior; the Workspace bridge owns the active palette.
    return (
        <ThemeProvider
            defaultTheme="dark"
            defaultColorTheme="runwield"
            storageKey="runwield-review-theme-mode"
            colorThemeStorageKey="runwield-review-color-theme"
        >
            <TooltipProvider>
                <div className="rw-plannotator-host rw-plan-review" data-review-mode={initialPayload.mode}>
                    <header className="rw-plannotator-toolbar">
                        <div className="rw-plan-review-heading">
                            <PlanReviewOptionsMenu
                                iconOnly
                                onOpenSettings={() => setSettingsOpen(true)}
                                onPrint={() => globalThis.print?.()}
                            />
                            <img src="/logo.svg" alt="" aria-hidden="true" />
                            <h1>Plan Review</h1>
                            {initialPayload.mode === "dev" && (
                                <p className="rw-plan-review-dev-notice" role="status">
                                    DEV MODE — Feedback and approval won’t go anywhere.
                                </p>
                            )}
                        </div>
                        <div className="rw-plannotator-actions">
                            {showExecutionPolicyControls && (
                                <ExecutionPolicyControls
                                    executionAgent={executionAgent}
                                    collaborationRecommendation={collaborationRecommendation}
                                    onAgentChange={selectExecutionAgent}
                                    onRecommendationChange={selectCollaborationRecommendation}
                                    disabled={submitting !== null}
                                />
                            )}
                            <FeedbackButton
                                onClick={submitFeedback}
                                disabled={(annotations.length === 0 && globalAttachments.length === 0) ||
                                    submitting !== null}
                                isLoading={submitting === "feedback"}
                                title={annotations.length === 0 && globalAttachments.length === 0
                                    ? "Add an annotation before sending feedback"
                                    : "Send all annotations"}
                            />
                            {showExecutionPolicyControls
                                ? (
                                    <PlanReviewApprovalActions
                                        primaryAction={primaryApprovalAction}
                                        onApprove={() => submitApprove(primaryApprovalAction)}
                                        onApproveLater={() => submitApprove(PLAN_APPROVAL_ACTIONS.LATER)}
                                        disabled={submitting !== null}
                                        isLoading={submitting === "approve"}
                                    />
                                )
                                : (
                                    <PlanApprovalSplitButton
                                        primaryAction={primaryApprovalAction}
                                        onApprove={submitApprove}
                                        disabled={submitting !== null}
                                        isLoading={submitting === "approve"}
                                    />
                                )}
                        </div>
                    </header>
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    <ScrollViewportContext.Provider value={scrollViewport}>
                        <div className="rw-plannotator-plan-layout" data-sidebar-open={sidebarOpen}>
                            {sidebarOpen && (
                                <SidebarContainer
                                    activeTab="toc"
                                    onTabChange={() => setSidebarOpen(false)}
                                    onClose={() => setSidebarOpen(false)}
                                    width={280}
                                    blocks={parsed.blocks}
                                    annotations={annotations}
                                    activeSection={activeSection}
                                    onTocNavigate={setActiveSection}
                                    showFilesTab={false}
                                    showVersionsTab={false}
                                    versionInfo={null}
                                    versions={[]}
                                    selectedBaseVersion={null}
                                    onSelectBaseVersion={() => {}}
                                    isPlanDiffActive={false}
                                    hasPreviousVersion={false}
                                    onActivatePlanDiff={() => {}}
                                    isLoadingVersions={false}
                                    isSelectingVersion={false}
                                    fetchingVersion={null}
                                    onFetchVersions={() => {}}
                                    showArchiveTab={false}
                                    archivePlans={[]}
                                    selectedArchiveFile={null}
                                    onArchiveSelect={() => {}}
                                    isLoadingArchive={false}
                                />
                            )}
                            {sidebarOpen && (
                                <ResizeHandle
                                    className="z-[55]"
                                    side="left"
                                    onCollapse={() => setSidebarOpen(false)}
                                />
                            )}
                            <main className="rw-plannotator-main-pane">
                                <div className="rw-plan-review-controls">
                                    <div
                                        className="rw-document-mode-toggle"
                                        role="tablist"
                                        aria-label="Plan review mode"
                                    >
                                        <button
                                            className={editorMode === "view" ? "active" : ""}
                                            type="button"
                                            onClick={() => setEditorMode("view")}
                                        >
                                            View
                                        </button>
                                        <button
                                            className={editorMode === "edit" ? "active" : ""}
                                            type="button"
                                            onClick={() => setEditorMode("edit")}
                                        >
                                            Edit
                                        </button>
                                    </div>
                                    {editorMode === "view"
                                        ? (
                                            <AnnotationToolstrip
                                                inputMethod={inputMethod}
                                                onInputMethodChange={setInputMethod}
                                                mode={annotationMode}
                                                onModeChange={setAnnotationMode}
                                                taterMode={false}
                                                showHelpLink={false}
                                            />
                                        )
                                        : (
                                            <div className="rw-editor-save-controls">
                                                <span role="status">{editorDirty ? "Unsaved changes" : "Saved"}</span>
                                                <button type="button" disabled={!editorDirty} onClick={saveEditor}>
                                                    Save
                                                </button>
                                            </div>
                                        )}
                                </div>
                                <div className="rw-plan-content-area">
                                    {!sidebarOpen && (
                                        <SidebarTabs
                                            className="rw-collapsed-sidebar-tabs"
                                            activeTab="toc"
                                            onToggleTab={() => setSidebarOpen(true)}
                                            hasDiff={false}
                                            showFilesTab={false}
                                            showVersionsTab={false}
                                            showMessagesTab={false}
                                            showAgentTerminalTab={false}
                                        />
                                    )}
                                    {editorMode === "view"
                                        ? (
                                            <OverlayScrollArea
                                                className="rw-plannotator-scroll-area"
                                                onViewportReady={setScrollViewport}
                                            >
                                                <div className="rw-plan-document-canvas">
                                                    <Viewer
                                                        key={plan}
                                                        ref={viewerHandleRef}
                                                        blocks={parsed.blocks}
                                                        markdown={plan}
                                                        frontmatter={parsed.frontmatter}
                                                        annotations={annotations}
                                                        globalAttachments={globalAttachments}
                                                        onAddGlobalAttachment={(image) =>
                                                            setGlobalAttachments((items) => [...items, image])}
                                                        onRemoveGlobalAttachment={(path) =>
                                                            setGlobalAttachments((items) =>
                                                                items.filter((item) => item.path !== path)
                                                            )}
                                                        onAddAnnotation={addAnnotation}
                                                        onSelectAnnotation={setSelectedAnnotationId}
                                                        selectedAnnotationId={selectedAnnotationId}
                                                        mode={annotationMode}
                                                        inputMethod={inputMethod}
                                                        taterMode={false}
                                                        stickyActions={uiPreferences.stickyActionsEnabled}
                                                        gridEnabled={gridEnabled}
                                                        maxWidth={planMaxWidth}
                                                        imageBaseDir={initialPayload.imageBaseDir}
                                                        onToggleCheckbox={toggleCheckbox}
                                                    />
                                                </div>
                                            </OverlayScrollArea>
                                        )
                                        : (
                                            <div className="rw-markdown-editor-pane">
                                                <MarkdownEditor
                                                    markdown={draftPlan}
                                                    documentId={initialPayload.token || "dev-plan"}
                                                    editorHandleRef={editorHandleRef}
                                                    onMarkdownChange={setDraftPlan}
                                                    maxWidth={planMaxWidth}
                                                    gridEnabled={gridEnabled}
                                                />
                                            </div>
                                        )}
                                </div>
                            </main>
                            <AnnotationPanel
                                isOpen={annotationsOpen}
                                annotations={annotations}
                                blocks={parsed.blocks}
                                onSelect={setSelectedAnnotationId}
                                onDelete={removeAnnotation}
                                onEdit={(id, updates) =>
                                    setAnnotations((items) =>
                                        items.map((item) => item.id === id ? { ...item, ...updates } : item)
                                    )}
                                selectedId={selectedAnnotationId}
                                sharingEnabled={false}
                                width={320}
                                onClose={() => setAnnotationsOpen(false)}
                            />
                            {!annotationsOpen && (
                                <button
                                    className="rw-annotation-reopen"
                                    type="button"
                                    onClick={() => setAnnotationsOpen(true)}
                                >
                                    Annotations
                                </button>
                            )}
                        </div>
                    </ScrollViewportContext.Provider>
                    <PlanReviewSettings
                        open={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                        onUIPreferencesChange={applyUIPreferences}
                    />
                    <CompletionOverlay
                        submitted={submitted}
                        title="Review decision sent"
                        subtitle="You can return to RunWield."
                        agentLabel="RunWield"
                    />
                </div>
            </TooltipProvider>
        </ThemeProvider>
    );

    async function submit(endpoint, body) {
        setError("");
        if (initialPayload.mode === "dev") {
            console.log("Plan review dev decision", { endpoint, body });
            return;
        }
        const response = await fetch(`/api/review/${endpoint}?token=${encodeURIComponent(initialPayload.token)}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-runwield-review-token": initialPayload.token,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const message = await response.text();
            setError(message || `Decision failed: ${response.status}`);
            throw new Error(message || `Decision failed: ${response.status}`);
        }
    }
}

function PlanApprovalSplitButton({ primaryAction, onApprove, disabled, isLoading }) {
    const isProject = primaryAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE;
    const primaryLabel = isProject ? "Approve & Slice" : "Approve & Run";
    const primaryMobileLabel = isProject ? "Slice" : "Run";
    const loadingLabel = isProject ? "Approving…" : "Approving…";

    function submitPrimary() {
        onApprove(primaryAction);
    }

    function submitForLater(closeMenu) {
        closeMenu();
        onApprove(PLAN_APPROVAL_ACTIONS.LATER);
    }

    return (
        <ActionMenu
            className="rw-approval-split-menu"
            panelClassName="rw-approval-action-menu absolute top-full right-0 mt-1 w-60 rounded-lg border border-border bg-popover py-1 shadow-xl z-[70]"
            renderTrigger={({ isOpen, toggleMenu }) => (
                <div className="rw-approval-split-button" aria-label="Plan approval actions">
                    <Button
                        variant="success"
                        size="xs"
                        className="rw-approval-primary"
                        onClick={submitPrimary}
                        disabled={disabled}
                        title={primaryLabel}
                        aria-label={primaryLabel}
                        iconLeft={<CheckIcon />}
                    >
                        <span className="md:hidden">{isLoading ? "…" : primaryMobileLabel}</span>
                        <span className="hidden md:inline">{isLoading ? loadingLabel : primaryLabel}</span>
                    </Button>
                    <Button
                        variant="success"
                        size="xs"
                        className="rw-approval-caret"
                        onClick={toggleMenu}
                        disabled={disabled}
                        title="More approval options"
                        aria-label="More approval options"
                        aria-expanded={isOpen}
                    >
                        <ChevronDownIcon />
                    </Button>
                </div>
            )}
        >
            {({ closeMenu }) => (
                <ActionMenuItem
                    onClick={() => submitForLater(closeMenu)}
                    icon={<ClockIcon />}
                    label="Approve for Later"
                    subtitle={isProject
                        ? "Approve and save this Epic for later Slicer decomposition."
                        : "Approve and save this Plan for later execution."}
                />
            )}
        </ActionMenu>
    );
}

function PlanReviewApprovalActions({ primaryAction, onApprove, onApproveLater, disabled, isLoading }) {
    const primaryLabel = primaryAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE ? "Approve & Slice" : "Approve & Run";
    return (
        <>
            <Button
                variant="outline"
                size="xs"
                className="rw-plan-review-secondary-action"
                onClick={onApproveLater}
                disabled={disabled}
                title="Approve for Later"
                aria-label="Approve for Later"
                iconLeft={<ClockIcon />}
            >
                <span className="hidden md:inline">Approve for Later</span>
            </Button>
            <Button
                variant="success"
                size="xs"
                className="rw-plan-review-primary-action"
                onClick={onApprove}
                disabled={disabled}
                title={primaryLabel}
                aria-label={primaryLabel}
                iconLeft={<CheckIcon />}
            >
                <span className="hidden md:inline">{isLoading ? "Approving…" : primaryLabel}</span>
            </Button>
        </>
    );
}

function ExecutionPolicyControls({
    executionAgent,
    collaborationRecommendation,
    onAgentChange,
    onRecommendationChange,
    disabled,
}) {
    return (
        <section className="rw-plan-review-execution-policy" aria-label="Execution configuration">
            <SegmentedPolicyControl
                label="Execution Agent"
                tooltip="Frontend Engineer owns materially visual/browser UI work. Engineer owns general implementation and always runs autonomously."
                value={executionAgent}
                onChange={onAgentChange}
                disabled={disabled}
                options={[
                    { value: "frontend-engineer", label: "Frontend Engineer" },
                    { value: "engineer", label: "Engineer" },
                ]}
            />
            <SegmentedPolicyControl
                label="Execution Style"
                tooltip="Pair Execution asks a capable host for checkpoints. Autonomous hands off the approved Plan; incapable hosts fall back without rewriting Pair."
                value={collaborationRecommendation}
                onChange={onRecommendationChange}
                disabled={disabled}
                options={[
                    {
                        value: "pair",
                        label: "Pair Execution",
                        disabled: executionAgent === "engineer",
                        disabledReason: "Pair Execution is available only with Frontend Engineer.",
                    },
                    { value: "autonomous", label: "Autonomous" },
                ]}
            />
        </section>
    );
}

function SegmentedPolicyControl({ label, tooltip, value, onChange, disabled, options }) {
    return (
        <Tooltip content={tooltip} side="bottom" align="center" wide>
            <fieldset className="rw-plan-review-segmented-policy" aria-label={label}>
                <legend className="rw-visually-hidden">{label}</legend>
                <div>
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={value === option.value ? "active" : ""}
                            aria-pressed={value === option.value}
                            disabled={disabled || option.disabled}
                            onClick={() => onChange(option.value)}
                            title={option.disabled ? option.disabledReason : tooltip}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </fieldset>
        </Tooltip>
    );
}

function PlanReviewOptionsMenu({ iconOnly = false, onOpenSettings, onPrint }) {
    return (
        <ActionMenu
            panelClassName={iconOnly
                ? "absolute top-full left-0 mt-1 w-56 rounded-lg border border-border bg-popover py-1 shadow-xl z-[70]"
                : undefined}
            renderTrigger={({ isOpen, toggleMenu }) => (
                <button
                    type="button"
                    onClick={toggleMenu}
                    className={`relative flex items-center gap-1.5 p-1.5 ${
                        iconOnly ? "" : "md:px-2.5 md:py-1"
                    } rounded-md text-xs font-medium transition-colors ${
                        isOpen
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title="Options"
                    aria-label="Options"
                    aria-expanded={isOpen}
                >
                    <MenuIcon />
                    {!iconOnly && <span className="hidden md:inline">Options</span>}
                </button>
            )}
        >
            {({ closeMenu }) => (
                <>
                    <ActionMenuItem
                        onClick={() => {
                            closeMenu();
                            onPrint();
                        }}
                        icon={<PrintIcon />}
                        label="Print / Save PDF"
                    />
                    <ActionMenuItem
                        onClick={() => {
                            closeMenu();
                            onOpenSettings();
                        }}
                        icon={<SettingsIcon />}
                        label="Settings"
                    />
                </>
            )}
        </ActionMenu>
    );
}

function CheckIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
    );
}

function ChevronDownIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
    );
}

function ClockIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2M12 22a10 10 0 110-20 10 10 0 010 20z"
            />
        </svg>
    );
}

function MenuIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

function PrintIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z"
            />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
    );
}

function toggleMarkdownCheckbox(markdown, lineNumber, checked) {
    const lines = markdown.split("\n");
    const index = lineNumber - 1;
    if (index < 0 || index >= lines.length) return markdown;
    const marker = checked ? "[x]" : "[ ]";
    const nextLine = lines[index].replace(/^(\s*(?:[-*]|\d+\.)\s*)\[[ xX]\]/, `$1${marker}`);
    if (nextLine === lines[index]) return markdown;
    const next = [...lines];
    next[index] = nextLine;
    return next.join("\n");
}

function readInitialExecutionPolicy(payload, parsedFrontmatter) {
    const frontmatter = payload?.frontmatter && typeof payload.frontmatter === "object"
        ? payload.frontmatter
        : parsedFrontmatter || {};
    const classification = readScalar(payload?.classification) || readScalar(frontmatter.classification) || "FEATURE";
    const executionPolicy = payload?.executionPolicy && typeof payload.executionPolicy === "object"
        ? payload.executionPolicy
        : {};
    const executionAgent = readExecutionAgent(executionPolicy.executionAgent) ||
        readExecutionAgent(payload?.executionAgent) ||
        readExecutionAgent(frontmatter.executionAgent) ||
        (frontmatter.frontend === true ? "frontend-engineer" : "engineer");
    const collaborationRecommendation = readCollaborationRecommendation(executionPolicy.collaborationRecommendation) ||
        readCollaborationRecommendation(payload?.collaborationRecommendation) ||
        readCollaborationRecommendation(frontmatter.collaborationRecommendation) || "autonomous";
    return {
        classification,
        canSelectExecutionPolicy: classification === "FEATURE",
        executionAgent,
        collaborationRecommendation: executionAgent === "engineer" ? "autonomous" : collaborationRecommendation,
    };
}

function readScalar(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (
        trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function readExecutionAgent(value) {
    const scalar = readScalar(value);
    return scalar === "engineer" || scalar === "frontend-engineer" ? scalar : undefined;
}

function readCollaborationRecommendation(value) {
    const scalar = readScalar(value);
    return scalar === "autonomous" || scalar === "pair" ? scalar : undefined;
}

function readEmbeddedPayload(name) {
    const node = document.querySelector(`script[data-${name}]`);
    if (!node?.textContent) return null;
    try {
        return JSON.parse(node.textContent);
    } catch {
        return null;
    }
}
