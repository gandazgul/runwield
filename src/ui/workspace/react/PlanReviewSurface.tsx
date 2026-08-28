// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider.tsx";
import { Tooltip, TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { Viewer } from "@plannotator/ui/components/Viewer.tsx";
import { MarkdownEditor } from "@plannotator/ui/components/MarkdownEditor.tsx";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel.tsx";
import { RunWieldAnnotationToolstrip } from "./RunWieldAnnotationToolstrip.tsx";
import { FeedbackButton } from "@plannotator/ui/components/ToolbarButtons.tsx";
import { PlanDiffViewer } from "@plannotator/ui/components/plan-diff/PlanDiffViewer.tsx";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";
import { CodeFilePopout } from "@plannotator/ui/components/CodeFilePopout.tsx";
import { ExportModal } from "@plannotator/ui/components/ExportModal.tsx";
import { ActionMenu, ActionMenuItem } from "@plannotator/ui/components/ActionMenu.tsx";
import { Button } from "@plannotator/ui/components/ui/button.tsx";
import { OverlayScrollArea } from "@plannotator/ui/components/OverlayScrollArea.tsx";
import { SidebarContainer } from "@plannotator/ui/components/sidebar/SidebarContainer.tsx";
import { ScrollViewportContext } from "@plannotator/ui/hooks/useScrollViewport.ts";
import { usePlanDiff } from "@plannotator/ui/hooks/usePlanDiff.ts";
import { useCodeFilePopout } from "@plannotator/ui/hooks/useCodeFilePopout.ts";
import { usePrintMode } from "@plannotator/ui/hooks/usePrintMode.ts";
import { useConfigValue } from "@plannotator/ui/config/index.ts";
import { getPlanSaveSettings } from "@plannotator/ui/utils/planSave.ts";
import { extractFrontmatter, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser.ts";
import { copyTextToClipboard } from "@plannotator/ui/utils/clipboard.ts";
import { getUIPreferences, PLAN_WIDTH_OPTIONS } from "@plannotator/ui/utils/uiPreferences.ts";
import { PlanReviewSettings } from "./PlanReviewSettings.tsx";
import {
    buildPlanReviewExecutionPolicyPayload,
    readPlanReviewExecutionPolicy,
    updatePlanReviewExecutionPolicy,
} from "./plan-review-policy.ts";
import {
    PLAN_APPROVAL_ACTIONS,
    primaryPlanApprovalActionForClassification,
} from "../../../shared/workflow/plan-approval.js";
import {
    createPlanReviewDraft,
    parsePlanReviewDraft,
    planReviewDraftDescription,
    planReviewDraftKey,
    serializePlanReviewDraft,
} from "./plan-review-draft.ts";
import { buildRunWieldDirectEditPanel } from "./plan-review-direct-edits.ts";
import { buildPlanReviewFeedback } from "./plan-review-feedback.ts";
import { normalizePlanReviewVersions } from "./plan-review-versions.ts";
import "./plannotator.css";

const DEFAULT_PLAN_PAYLOAD = { plan: "", token: "", mode: "dev" };

export function PlanReviewSurface({ payload }) {
    usePrintMode();
    const initialPayload = useMemo(() => payload || readEmbeddedPayload("review-payload") || DEFAULT_PLAN_PAYLOAD, [
        payload,
    ]);
    const submittedPlan = initialPayload.plan || "";
    const reviewDraftKey = planReviewDraftKey(initialPayload.token || initialPayload.planPath || "dev-plan");
    const [plan, setPlan] = useState(initialPayload.plan || "");
    const [draftPlan, setDraftPlan] = useState(initialPayload.plan || "");
    const [editorMode, setEditorMode] = useState("view");
    const [isPlanDiffActive, setIsPlanDiffActive] = useState(false);
    const [planDiffMode, setPlanDiffMode] = useState("clean");
    const [uiPreferences, setUiPreferences] = useState(() => getUIPreferences());
    const [sidebarOpen, setSidebarOpen] = useState(() => getUIPreferences().tocEnabled);
    const [sidebarTab, setSidebarTab] = useState("toc");
    const [annotationsOpen, setAnnotationsOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [annotations, setAnnotations] = useState([]);
    const [codeAnnotations, setCodeAnnotations] = useState([]);
    const [globalAttachments, setGlobalAttachments] = useState([]);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
    const [selectedCodeAnnotationId, setSelectedCodeAnnotationId] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const [annotationMode, setAnnotationMode] = useState("selection");
    const [inputMethod, setInputMethod] = useState("drag");
    const [scrollViewport, setScrollViewport] = useState(null);
    const [submitting, setSubmitting] = useState(null);
    const [submitted, setSubmitted] = useState(null);
    const [error, setError] = useState("");
    const [recoveryRequest, setRecoveryRequest] = useState(null);
    const [pendingReviewDraft, setPendingReviewDraft] = useState(null);
    const [reviewDraftReady, setReviewDraftReady] = useState(false);
    const [reviewDraftStorageError, setReviewDraftStorageError] = useState("");
    const editorHandleRef = useRef(null);
    const viewerHandleRef = useRef(null);
    const gridEnabled = useConfigValue("gridEnabled");
    const editorDirty = draftPlan !== plan;
    const directlyEditedPlan = draftPlan === submittedPlan ? null : draftPlan;
    const directEditPanel = useMemo(
        () => buildRunWieldDirectEditPanel(submittedPlan, directlyEditedPlan ?? submittedPlan),
        [directlyEditedPlan, submittedPlan],
    );
    const hasReviewFeedback = annotations.length > 0 || codeAnnotations.length > 0 || globalAttachments.length > 0 ||
        directlyEditedPlan !== null;
    const planWidthMode = uiPreferences.planWidth;
    const planMaxWidth = useMemo(
        () =>
            planWidthMode === "wide"
                ? null
                : PLAN_WIDTH_OPTIONS.find((option) => option.id === planWidthMode)?.px || 832,
        [planWidthMode],
    );
    const parsed = useMemo(() => {
        const frontmatterResult = extractFrontmatter(plan);
        return {
            blocks: parseMarkdownToBlocks(plan),
            frontmatter: frontmatterResult.frontmatter,
        };
    }, [plan]);
    const legacyPreviousPlan = typeof initialPayload.previousPlan === "string" && initialPayload.previousPlan.trim()
        ? initialPayload.previousPlan
        : null;
    const planVersions = useMemo(
        () =>
            normalizePlanReviewVersions(
                submittedPlan,
                legacyPreviousPlan,
                Array.isArray(initialPayload.planVersions) ? initialPayload.planVersions : null,
            ),
        [initialPayload.planVersions, legacyPreviousPlan, submittedPlan],
    );
    const versionInfo = planVersions.length > 1
        ? { version: planVersions.length, totalVersions: planVersions.length, project: "RunWield" }
        : null;
    const previousPlan = planVersions.length > 1 ? planVersions.at(-2)?.plan ?? null : null;
    const planDiffFetchers = useMemo(() => ({
        fetchVersion: (version) => {
            const entry = planVersions.find((candidate) => candidate.version === version);
            if (!entry) return Promise.reject(new Error(`Plan version ${version} is unavailable.`));
            return Promise.resolve({ plan: entry.plan, version: entry.version });
        },
        fetchVersions: () =>
            Promise.resolve({
                project: "RunWield",
                slug: initialPayload.planPath || "plan",
                versions: planVersions.map(({ version, timestamp }) => ({ version, timestamp })),
            }),
    }), [initialPayload.planPath, planVersions]);
    const planDiff = usePlanDiff(
        plan,
        previousPlan,
        versionInfo,
        planDiffFetchers,
    );
    const selectedVersionLabel = planDiff.diffBaseVersion ? `version ${planDiff.diffBaseVersion}` : "previous version";
    const affectedPaths = useMemo(
        () =>
            Array.isArray(parsed.frontmatter?.affectedPaths)
                ? parsed.frontmatter.affectedPaths
                    .filter((path) => typeof path === "string" && path.trim())
                    .map(normalizeReferencedPath)
                : [],
        [parsed.frontmatter],
    );
    const buildFileContentUrl = useCallback((requestedPath) => {
        const filePath = requestedPath.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, "");
        const devContents = initialPayload.linkedFiles?.[filePath];
        if (initialPayload.mode === "dev") {
            const body = typeof devContents === "string"
                ? { codeFile: true, contents: devContents, filepath: filePath }
                : { codeFile: false, error: `File not found in project: ${filePath}` };
            return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(body))}`;
        }
        const params = new URLSearchParams({ path: requestedPath, base: "docs/plans" });
        if (initialPayload.mode === "workspace" && initialPayload.projectId) {
            return `/api/owner/projects/${encodeURIComponent(initialPayload.projectId)}/files/content?${params}`;
        }
        params.set("token", initialPayload.token);
        return `/api/file-content?${params}`;
    }, [initialPayload.linkedFiles, initialPayload.mode, initialPayload.projectId, initialPayload.token]);
    const codeFilePopout = useCodeFilePopout({ buildUrl: buildFileContentUrl });
    const trustedPolicy = readPlanReviewExecutionPolicy(initialPayload, parsed.frontmatter);
    const planClassification = trustedPolicy.classification;
    const showExecutionPolicyControls = trustedPolicy.canSelectExecutionPolicy;
    const primaryApprovalAction = primaryPlanApprovalActionForClassification(planClassification);
    const outcomeCopy = reviewOutcomeCopy(submitted, planClassification, initialPayload.reviewContext?.sessionLabel);
    const [executionPolicy, setExecutionPolicy] = useState(trustedPolicy);
    const executionAgent = executionPolicy.executionAgent;
    const collaborationRecommendation = executionPolicy.collaborationRecommendation;

    const persistReviewDraftLocally = useCallback((reportError = true) => {
        try {
            if (!hasReviewFeedback) {
                globalThis.localStorage?.removeItem(reviewDraftKey);
            } else {
                const draft = createPlanReviewDraft({
                    basePlan: submittedPlan,
                    annotations,
                    codeAnnotations,
                    globalAttachments,
                    editedPlan: directlyEditedPlan,
                });
                globalThis.localStorage?.setItem(reviewDraftKey, serializePlanReviewDraft(draft));
            }
            if (reportError) setReviewDraftStorageError("");
        } catch {
            if (reportError) {
                setReviewDraftStorageError("This review draft could not be saved in the browser.");
            }
        }
    }, [
        annotations,
        codeAnnotations,
        directlyEditedPlan,
        globalAttachments,
        hasReviewFeedback,
        reviewDraftKey,
        submittedPlan,
    ]);

    useEffect(() => {
        setReviewDraftReady(false);
        try {
            const raw = globalThis.localStorage?.getItem(reviewDraftKey);
            const recovered = raw ? parsePlanReviewDraft(raw, submittedPlan) : null;
            if (raw && !recovered) globalThis.localStorage?.removeItem(reviewDraftKey);
            setPendingReviewDraft(recovered);
        } catch {
            setReviewDraftStorageError("This review draft could not be read from the browser.");
        } finally {
            setReviewDraftReady(true);
        }
    }, [reviewDraftKey, submittedPlan]);

    useEffect(() => {
        if (!reviewDraftReady || pendingReviewDraft || submitted !== null) return;
        const timer = setTimeout(() => persistReviewDraftLocally(), 500);
        return () => clearTimeout(timer);
    }, [pendingReviewDraft, persistReviewDraftLocally, reviewDraftReady, submitted]);

    useEffect(() => {
        if (!reviewDraftReady || pendingReviewDraft || submitted !== null) return;
        const persistBeforeClose = () => persistReviewDraftLocally(false);
        globalThis.addEventListener?.("pagehide", persistBeforeClose);
        return () => globalThis.removeEventListener?.("pagehide", persistBeforeClose);
    }, [pendingReviewDraft, persistReviewDraftLocally, reviewDraftReady, submitted]);

    async function submitApprove(approvalAction) {
        setSubmitting("approve");
        try {
            const result = await submit("decision", {
                approved: true,
                approvalAction,
                ...buildApprovalPolicyPayload(),
                ...buildReviewPayload(),
                ...buildPlanSavePayload(),
            });
            if (result?.status === "recovery_required" || result?.result?.kind === "recovery_required") return;
            clearReviewDraft();
            setSubmitted(
                approvalAction === PLAN_APPROVAL_ACTIONS.LATER ? "approved-later" : `approved-${approvalAction}`,
            );
            if (approvalAction === PLAN_APPROVAL_ACTIONS.RUN && initialPayload.progressUrl) {
                globalThis.location.assign(initialPayload.progressUrl);
            }
        } catch {
            // submit() owns the visible error state.
        } finally {
            setSubmitting(null);
        }
    }

    async function submitFeedback() {
        setSubmitting("feedback");
        try {
            const result = await submit("deny", {
                ...buildReviewPayload(),
                ...buildPlanSavePayload(),
            });
            if (result?.status === "recovery_required" || result?.result?.kind === "recovery_required") return;
            clearReviewDraft();
            setSubmitted("feedback");
        } catch {
            // submit() owns the visible error state.
        } finally {
            setSubmitting(null);
        }
    }

    function addAnnotation(annotation) {
        const next = {
            ...annotation,
            id: annotation.id || crypto.randomUUID(),
            type: annotation.type || "COMMENT",
            createdA: annotation.createdA || Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedCodeAnnotationId(null);
        setSelectedAnnotationId(next.id);
    }

    function addCodeAnnotation(input) {
        const next = {
            id: `code-${crypto.randomUUID()}`,
            type: "comment",
            scope: "line",
            filePath: input.filePath,
            lineStart: input.lineStart,
            lineEnd: input.lineEnd,
            side: "new",
            text: input.text,
            images: input.images,
            originalCode: input.originalCode,
            createdAt: Date.now(),
        };
        setCodeAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(null);
        setSelectedCodeAnnotationId(next.id);
    }

    function removeCodeAnnotation(id) {
        setCodeAnnotations((items) => items.filter((item) => item.id !== id));
        setSelectedCodeAnnotationId((selectedId) => selectedId === id ? null : selectedId);
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

    function showPlanView() {
        if (editorMode === "edit" && editorDirty) saveEditor();
        setIsPlanDiffActive(false);
        setEditorMode("view");
    }

    function showPlanEditor() {
        setIsPlanDiffActive(false);
        setEditorMode("edit");
    }

    function showPlanChanges() {
        if (editorMode === "edit" && editorDirty) saveEditor();
        setEditorMode("view");
        setIsPlanDiffActive(true);
    }

    async function selectPlanVersion(version) {
        if (editorMode === "edit" && editorDirty) saveEditor();
        await planDiff.selectBaseVersion(version);
        setEditorMode("view");
        setIsPlanDiffActive(true);
    }

    function openSidebarTab(tab) {
        setSidebarTab(tab);
        setSidebarOpen(true);
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
        const reviewedPlan = currentPlan();
        const feedback = currentFeedback(reviewedPlan);
        return {
            ...(hasReviewFeedback && { feedback }),
            annotations,
            codeAnnotations,
            globalAttachments,
        };
    }

    function currentFeedback(reviewedPlan = currentPlan()) {
        return buildPlanReviewFeedback({
            blocks: parsed.blocks,
            annotations,
            codeAnnotations,
            globalAttachments,
            basePlan: submittedPlan,
            reviewedPlan,
        });
    }

    function restoreReviewDraft() {
        if (!pendingReviewDraft) return;
        setAnnotations(pendingReviewDraft.annotations);
        setCodeAnnotations(pendingReviewDraft.codeAnnotations);
        setGlobalAttachments(pendingReviewDraft.globalAttachments);
        if (pendingReviewDraft.editedPlan !== null) {
            setPlan(pendingReviewDraft.editedPlan);
            setDraftPlan(pendingReviewDraft.editedPlan);
        }
        setPendingReviewDraft(null);
        setReviewDraftStorageError("");
    }

    function discardReviewDraft() {
        try {
            globalThis.localStorage?.removeItem(reviewDraftKey);
        } catch {
            // The in-memory review can continue even when browser storage is unavailable.
        }
        setPendingReviewDraft(null);
        setReviewDraftStorageError("");
    }

    function clearReviewDraft() {
        try {
            globalThis.localStorage?.removeItem(reviewDraftKey);
        } catch {
            // Submission succeeded; a storage cleanup failure must not change the decision.
        }
        setPendingReviewDraft(null);
        setReviewDraftStorageError("");
    }

    function buildApprovalPolicyPayload() {
        if (!showExecutionPolicyControls) return {};
        return buildPlanReviewExecutionPolicyPayload(executionPolicy);
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

    async function runRecoveryAction() {
        if (!recoveryRequest?.url) return;
        const confirmed = globalThis.confirm?.(
            "RunWield will recover the Workspace Session control record for this Plan review. Your Plan text is not changed. Continue?",
        );
        if (!confirmed) return;
        setSubmitting("recovery");
        setError("");
        try {
            const headers = { "content-type": "application/json" };
            if (initialPayload.csrfToken) headers["x-runwield-csrf"] = initialPayload.csrfToken;
            const response = await fetch(recoveryRequest.url, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    expectedGeneration: recoveryRequest.expectedGeneration,
                    expectedCurrentSegmentId: recoveryRequest.expectedCurrentSegmentId || null,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || `Recovery failed: ${response.status}`);
            setRecoveryRequest(null);
            setError("Recovery finished. Refresh the review, then send the decision again.");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
        } finally {
            setSubmitting(null);
        }
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
                <div
                    className="rw-plannotator-host rw-plan-review"
                    data-review-mode={initialPayload.mode}
                    data-plan-width={planWidthMode}
                >
                    <header className="rw-plannotator-toolbar">
                        <div className="rw-plan-review-heading">
                            <PlanReviewOptionsMenu
                                iconOnly
                                onOpenExport={() => setExportOpen(true)}
                                onOpenSettings={() => setSettingsOpen(true)}
                                onPrint={() => globalThis.print?.()}
                            />
                            <img src="/brand/logo.svg" alt="" aria-hidden="true" />
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
                                    onAgentChange={(value) =>
                                        setExecutionPolicy((current) =>
                                            updatePlanReviewExecutionPolicy(current, {
                                                field: "executionAgent",
                                                value,
                                            })
                                        )}
                                    onRecommendationChange={(value) =>
                                        setExecutionPolicy((current) =>
                                            updatePlanReviewExecutionPolicy(current, {
                                                field: "collaborationRecommendation",
                                                value,
                                            })
                                        )}
                                    disabled={submitting !== null}
                                />
                            )}
                            <PlanApprovalSplitButton
                                primaryAction={primaryApprovalAction}
                                onApprove={submitApprove}
                                disabled={submitting !== null}
                                isLoading={submitting === "approve"}
                            />
                        </div>
                    </header>
                    {initialPayload.reviewContext && (
                        <section className="rw-plan-review-context" aria-label="Plan review context">
                            <nav aria-label="Plan location">
                                <span>{initialPayload.reviewContext.projectLabel || "Project"}</span>
                                <span aria-hidden="true">→</span>
                                <a href={initialPayload.reviewContext.sessionHref || "#session"}>
                                    {initialPayload.reviewContext.sessionLabel || "Session"}
                                </a>
                                <span aria-hidden="true">→</span>
                                <span>{initialPayload.reviewContext.planLabel || "Plan"}</span>
                            </nav>
                            <div>
                                <span>
                                    {initialPayload.reviewContext.actingSession || "Acting Session not recorded"}
                                </span>
                                <span>{initialPayload.reviewContext.planStatus || "Status unknown"}</span>
                                <span>{initialPayload.reviewContext.live ? "Live review" : "Settled review"}</span>
                            </div>
                        </section>
                    )}
                    {initialPayload.reviewNotice && (
                        <section
                            className={`rw-plan-review-notice state-${initialPayload.reviewNotice.state || "info"}`}
                            role="status"
                        >
                            <strong>{initialPayload.reviewNotice.title || "Review status"}</strong>
                            <p>{initialPayload.reviewNotice.message}</p>
                            {initialPayload.reviewNotice.actionLabel && initialPayload.reviewNotice.actionHref
                                ? (
                                    <a href={initialPayload.reviewNotice.actionHref}>
                                        {initialPayload.reviewNotice.actionLabel}
                                    </a>
                                )
                                : null}
                        </section>
                    )}
                    {pendingReviewDraft && (
                        <section
                            className="rw-plan-review-notice rw-plan-review-draft-notice"
                            aria-labelledby="rw-plan-review-draft-title"
                        >
                            <div>
                                <strong id="rw-plan-review-draft-title">Unfinished review found</strong>
                                <p>
                                    Restore {planReviewDraftDescription(pendingReviewDraft)}{" "}
                                    from this browser, or discard it and start fresh.
                                </p>
                            </div>
                            <div className="rw-plan-review-draft-actions">
                                <Button size="xs" type="button" onClick={restoreReviewDraft}>Restore draft</Button>
                                <Button size="xs" type="button" variant="ghost" onClick={discardReviewDraft}>
                                    Discard
                                </Button>
                            </div>
                        </section>
                    )}
                    {reviewDraftStorageError && (
                        <p className="rw-review-error" role="alert">{reviewDraftStorageError}</p>
                    )}
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    {recoveryRequest
                        ? (
                            <section className="rw-plan-review-notice state-recovery" role="alert">
                                <strong>Recovery needed</strong>
                                <p>{recoveryRequest.message}</p>
                                {recoveryRequest.url
                                    ? (
                                        <button
                                            type="button"
                                            className="rw-plan-review-recovery-action"
                                            disabled={submitting !== null}
                                            onClick={runRecoveryAction}
                                        >
                                            {submitting === "recovery" ? "Recovering…" : "Recover in Workspace"}
                                        </button>
                                    )
                                    : null}
                            </section>
                        )
                        : null}
                    <ScrollViewportContext.Provider value={scrollViewport}>
                        <div
                            className="rw-plannotator-plan-layout"
                            data-sidebar-open={sidebarOpen}
                            data-annotations-open={annotationsOpen}
                        >
                            {sidebarOpen && versionInfo !== null && (
                                <div
                                    className="rw-plan-sidebar-tab-toggle rw-segmented-toggle"
                                    role="tablist"
                                    aria-label="Plan sidebar"
                                >
                                    <button
                                        type="button"
                                        aria-selected={sidebarTab === "toc"}
                                        onClick={() => setSidebarTab("toc")}
                                        title="Contents"
                                    >
                                        <ToggleIcon name="contents" />
                                        <span>Contents</span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-selected={sidebarTab === "versions"}
                                        onClick={() => setSidebarTab("versions")}
                                        title="Versions"
                                    >
                                        <ToggleIcon name="versions" />
                                        <span>Versions</span>
                                    </button>
                                </div>
                            )}
                            {sidebarOpen && (
                                <SidebarContainer
                                    activeTab={sidebarTab}
                                    onTabChange={setSidebarTab}
                                    onClose={() => setSidebarOpen(false)}
                                    width={280}
                                    blocks={parsed.blocks}
                                    annotations={annotations}
                                    activeSection={activeSection}
                                    onTocNavigate={(blockId) => {
                                        showPlanView();
                                        setActiveSection(blockId);
                                    }}
                                    showFilesTab={false}
                                    showVersionsTab={versionInfo !== null}
                                    versionInfo={versionInfo}
                                    versions={planDiff.versions}
                                    selectedBaseVersion={planDiff.diffBaseVersion}
                                    onSelectBaseVersion={selectPlanVersion}
                                    isPlanDiffActive={isPlanDiffActive}
                                    hasPreviousVersion={planDiff.hasPreviousVersion}
                                    onActivatePlanDiff={showPlanChanges}
                                    isLoadingVersions={planDiff.isLoadingVersions}
                                    isSelectingVersion={planDiff.isSelectingVersion}
                                    fetchingVersion={planDiff.fetchingVersion}
                                    onFetchVersions={planDiff.fetchVersions}
                                    showArchiveTab={false}
                                    archivePlans={[]}
                                    selectedArchiveFile={null}
                                    onArchiveSelect={() => {}}
                                    isLoadingArchive={false}
                                />
                            )}
                            {sidebarOpen && (
                                <button
                                    className="rw-plan-review-sidebar-collapse"
                                    type="button"
                                    onClick={() => setSidebarOpen(false)}
                                    title="Collapse contents sidebar"
                                    aria-label="Collapse contents sidebar"
                                >
                                    <PanelCollapseIcon side="left" />
                                </button>
                            )}
                            <main className="rw-plannotator-main-pane">
                                <div className="rw-review-toolbar rw-plan-review-controls">
                                    <div className="rw-review-toolbar-edge rw-review-toolbar-edge-left rw-plan-review-sidebar-restore rw-plan-review-sidebar-restore-left">
                                        {!sidebarOpen && (
                                            <button
                                                className="rw-toolbar-button"
                                                type="button"
                                                onClick={() => openSidebarTab("toc")}
                                            >
                                                <ToggleIcon name="contents" />
                                                <span>Contents</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="rw-review-toolbar-center rw-plan-review-mode-actions">
                                        <div
                                            className="rw-document-mode-toggle rw-segmented-toggle"
                                            role="tablist"
                                            aria-label="Plan review mode"
                                        >
                                            <button
                                                className={editorMode === "view" && !isPlanDiffActive ? "active" : ""}
                                                type="button"
                                                onClick={showPlanView}
                                                title="View"
                                            >
                                                <ToggleIcon name="view" />
                                                <span>View</span>
                                            </button>
                                            <button
                                                className={editorMode === "edit" && !isPlanDiffActive ? "active" : ""}
                                                type="button"
                                                onClick={showPlanEditor}
                                                title="Edit"
                                            >
                                                <ToggleIcon name="edit" />
                                                <span>Edit</span>
                                            </button>
                                            {planDiff.hasPreviousVersion && (
                                                <button
                                                    className={isPlanDiffActive ? "active" : ""}
                                                    type="button"
                                                    onClick={showPlanChanges}
                                                    title="Changes"
                                                >
                                                    <ToggleIcon name="changes" />
                                                    <span>Changes</span>
                                                </button>
                                            )}
                                        </div>
                                        {affectedPaths.length > 0 && (
                                            <AffectedFilesMenu paths={affectedPaths} onOpen={codeFilePopout.open} />
                                        )}
                                        {isPlanDiffActive
                                            ? (
                                                <span className="rw-plan-diff-context" role="status">
                                                    Comparing current revision with {selectedVersionLabel}
                                                </span>
                                            )
                                            : editorMode === "view"
                                            ? (
                                                <RunWieldAnnotationToolstrip
                                                    inputMethod={inputMethod}
                                                    onInputMethodChange={setInputMethod}
                                                    mode={annotationMode}
                                                    onModeChange={setAnnotationMode}
                                                    taterMode={false}
                                                    compact
                                                    showHelpLink={false}
                                                />
                                            )
                                            : null}
                                    </div>
                                    <div className="rw-review-toolbar-edge rw-review-toolbar-edge-right rw-plan-review-sidebar-restore rw-plan-review-sidebar-restore-right">
                                        {editorMode === "edit" && !isPlanDiffActive && (
                                            <div className="rw-editor-save-controls">
                                                <span role="status">
                                                    {editorDirty ? "Unsaved changes" : "Saved"}
                                                </span>
                                                <button
                                                    className="rw-toolbar-button"
                                                    type="button"
                                                    disabled={!editorDirty}
                                                    onClick={saveEditor}
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        )}
                                        {!annotationsOpen && (
                                            <button
                                                className="rw-toolbar-button"
                                                type="button"
                                                onClick={() => setAnnotationsOpen(true)}
                                            >
                                                <ToggleIcon name="annotations" />
                                                <span>Annotations</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="rw-plan-content-area">
                                    {isPlanDiffActive && planDiff.diffBlocks && planDiff.diffStats
                                        ? (
                                            <OverlayScrollArea
                                                className="rw-plannotator-scroll-area"
                                                onViewportReady={setScrollViewport}
                                            >
                                                <div className="rw-plan-document-canvas rw-plan-diff-canvas">
                                                    <PlanDiffViewer
                                                        diffBlocks={planDiff.diffBlocks}
                                                        diffStats={planDiff.diffStats}
                                                        diffMode={planDiffMode}
                                                        onDiffModeChange={setPlanDiffMode}
                                                        onPlanDiffToggle={showPlanView}
                                                        baseVersionLabel={selectedVersionLabel}
                                                        maxWidth={planMaxWidth ?? undefined}
                                                        annotations={annotations}
                                                        onAddAnnotation={addAnnotation}
                                                        onSelectAnnotation={setSelectedAnnotationId}
                                                        selectedAnnotationId={selectedAnnotationId}
                                                        mode={annotationMode}
                                                    />
                                                </div>
                                            </OverlayScrollArea>
                                        )
                                        : editorMode === "view"
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
                                                        disableCodePathValidation
                                                        onOpenCodeFile={codeFilePopout.open}
                                                        onOpenLinkedDoc={codeFilePopout.open}
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
                            {annotationsOpen && (
                                <aside
                                    className="rw-plan-review-annotation-sidebar"
                                    data-annotation-panel="true"
                                    data-plan-sidebar="right"
                                    aria-labelledby="rw-plan-review-annotations-heading"
                                >
                                    <div className="rw-plan-review-annotation-heading">
                                        <div>
                                            <ToggleIcon name="annotations" />
                                            <h2 id="rw-plan-review-annotations-heading">Annotations</h2>
                                            {annotations.length + codeAnnotations.length > 0 && (
                                                <span>{annotations.length + codeAnnotations.length}</span>
                                            )}
                                        </div>
                                        <button
                                            className="rw-plan-review-annotation-close"
                                            type="button"
                                            onClick={() => setAnnotationsOpen(false)}
                                            title="Collapse annotations sidebar"
                                            aria-label="Collapse annotations sidebar"
                                        >
                                            <PanelCollapseIcon side="right" />
                                        </button>
                                    </div>
                                    <div className="rw-review-feedback-action rw-review-action">
                                        <FeedbackButton
                                            onClick={submitFeedback}
                                            disabled={!hasReviewFeedback || submitting !== null}
                                            isLoading={submitting === "feedback"}
                                            label="Send Annotations"
                                            loadingLabel="Sending Annotations…"
                                            title={!hasReviewFeedback
                                                ? "Add a Plan or file annotation, attachment, or direct Plan edit before sending annotations"
                                                : "Send annotations"}
                                        />
                                    </div>
                                    <AnnotationPanel
                                        isOpen
                                        presentation="embedded"
                                        annotations={annotations}
                                        codeAnnotations={codeAnnotations}
                                        blocks={parsed.blocks}
                                        onSelect={(id) => {
                                            setSelectedCodeAnnotationId(null);
                                            setSelectedAnnotationId(id);
                                        }}
                                        onDelete={removeAnnotation}
                                        onEdit={(id, updates) =>
                                            setAnnotations((items) =>
                                                items.map((item) => item.id === id ? { ...item, ...updates } : item)
                                            )}
                                        onSelectCodeAnnotation={(id) => {
                                            const annotation = codeAnnotations.find((item) => item.id === id);
                                            if (!annotation) return;
                                            setSelectedAnnotationId(null);
                                            setSelectedCodeAnnotationId(id);
                                            codeFilePopout.open(annotation.filePath);
                                        }}
                                        onDeleteCodeAnnotation={removeCodeAnnotation}
                                        onEditCodeAnnotation={(id, updates) =>
                                            setCodeAnnotations((items) =>
                                                items.map((item) => item.id === id ? { ...item, ...updates } : item)
                                            )}
                                        onQuickCopy={() => copyTextToClipboard(currentFeedback())}
                                        selectedId={selectedCodeAnnotationId || selectedAnnotationId}
                                        sharingEnabled={false}
                                        directEdits={directEditPanel}
                                    />
                                </aside>
                            )}
                        </div>
                    </ScrollViewportContext.Provider>
                    <PlanReviewSettings
                        open={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                        onUIPreferencesChange={applyUIPreferences}
                    />
                    <ExportModal
                        isOpen={exportOpen}
                        onClose={() => setExportOpen(false)}
                        shareUrl=""
                        shareUrlSize=""
                        annotationsOutput={exportOpen ? currentFeedback() : ""}
                        annotationCount={annotations.length + codeAnnotations.length}
                        sharingEnabled={false}
                        wrapCopiedAnnotations={(feedback) => feedback}
                    />
                    {codeFilePopout.popoutProps && (
                        <CodeFilePopout
                            {...codeFilePopout.popoutProps}
                            annotations={codeAnnotations.filter((item) =>
                                item.filePath === codeFilePopout.popoutProps?.filepath
                            )}
                            selectedAnnotationId={selectedCodeAnnotationId}
                            onAddAnnotation={addCodeAnnotation}
                            onEditAnnotation={(id, updates) =>
                                setCodeAnnotations((items) =>
                                    items.map((item) => item.id === id ? { ...item, ...updates } : item)
                                )}
                            onDeleteAnnotation={removeCodeAnnotation}
                            onSelectAnnotation={(id) => {
                                setSelectedAnnotationId(null);
                                setSelectedCodeAnnotationId(id);
                            }}
                        />
                    )}
                    <CompletionOverlay
                        submitted={submitted}
                        title={outcomeCopy.title}
                        subtitle={outcomeCopy.subtitle}
                        agentLabel="RunWield"
                    />
                </div>
            </TooltipProvider>
        </ThemeProvider>
    );

    async function submit(endpoint, body) {
        setError("");
        setRecoveryRequest(null);
        if (initialPayload.mode === "dev") {
            console.log("Plan review dev decision", { endpoint, body });
            return { status: "accepted" };
        }
        const targetUrl = initialPayload.interactionAnswerUrl || initialPayload.submitUrl ||
            `/api/review/${endpoint}?token=${encodeURIComponent(initialPayload.token)}`;
        const headers = {
            "content-type": "application/json",
            "x-runwield-review-token": initialPayload.token,
        };
        if (initialPayload.csrfToken) headers["x-runwield-csrf"] = initialPayload.csrfToken;
        const requestId = crypto.randomUUID();
        const response = await fetch(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(
                initialPayload.interactionAnswerUrl
                    ? {
                        requestId,
                        runwieldSessionId: initialPayload.runwieldSessionId,
                        response: { outcome: "accepted", _meta: body },
                    }
                    : initialPayload.submitUrl
                    ? { requestId, action: endpoint, ...body }
                    : body,
            ),
        });
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json().catch(() => ({})) : null;
        const result = payload?.result || payload;
        if (result?.status === "recovery_required" || result?.kind === "recovery_required") {
            setRecoveryRequest({
                message: result.message || payload?.error ||
                    "Plan review recovery is required before this decision can be applied.",
                url: initialPayload.recoveryUrl,
                expectedGeneration: initialPayload.recoveryExpectedGeneration,
                expectedCurrentSegmentId: initialPayload.recoveryExpectedCurrentSegmentId,
            });
            return payload;
        }
        if (!response.ok) {
            const message = payload?.error || `Decision failed: ${response.status}`;
            setError(message || `Decision failed: ${response.status}`);
            throw new Error(message || `Decision failed: ${response.status}`);
        }
        return payload || { status: "accepted" };
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
                tooltip="Frontend Engineer owns materially visual/browser UI work. Engineer owns general implementation."
                value={executionAgent}
                onChange={onAgentChange}
                disabled={disabled}
                options={[
                    { value: "engineer", label: "Engineer", icon: "engineer" },
                    { value: "frontend-engineer", label: "Frontend Engineer", icon: "frontend" },
                ]}
            />
            <SegmentedPolicyControl
                label="Execution Style"
                tooltip="Pair Execution asks a capable host for checkpoints. Autonomous hands off the approved Plan; incapable hosts fall back without rewriting Pair."
                value={collaborationRecommendation}
                onChange={onRecommendationChange}
                disabled={disabled}
                options={[
                    { value: "pair", label: "Pair Execution", icon: "pair" },
                    { value: "autonomous", label: "Autonomous", icon: "autonomous" },
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
                <div className="rw-segmented-toggle">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className={value === option.value ? "active" : ""}
                            aria-pressed={value === option.value}
                            disabled={disabled}
                            onClick={() => onChange(option.value)}
                            title={option.label}
                        >
                            {option.icon && <ToggleIcon name={option.icon} />}
                            <span>{option.label}</span>
                        </button>
                    ))}
                </div>
            </fieldset>
        </Tooltip>
    );
}

function AffectedFilesMenu({ paths, onOpen }) {
    return (
        <ActionMenu
            panelClassName="absolute top-full left-0 mt-1 min-w-72 max-w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover py-1 shadow-xl z-[70]"
            renderTrigger={({ isOpen, toggleMenu }) => (
                <button
                    type="button"
                    onClick={toggleMenu}
                    className={`rw-affected-files-trigger ${isOpen ? "active" : ""}`}
                    aria-expanded={isOpen}
                    title="Inspect files referenced by this Plan"
                >
                    <FileIcon />
                    <span>Files</span>
                    <span className="rw-affected-files-count">{paths.length}</span>
                </button>
            )}
        >
            {({ closeMenu }) => (
                <>
                    <div className="rw-affected-files-menu-heading">Affected files</div>
                    {paths.map((path) => (
                        <ActionMenuItem
                            key={path}
                            onClick={() => {
                                closeMenu();
                                onOpen(path);
                            }}
                            icon={<FileIcon />}
                            label={path}
                        />
                    ))}
                </>
            )}
        </ActionMenu>
    );
}

function normalizeReferencedPath(path) {
    const trimmed = path.trim();
    return trimmed.length >= 2 && (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
        )
        ? trimmed.slice(1, -1)
        : trimmed;
}

function PlanReviewOptionsMenu({ iconOnly = false, onOpenExport, onOpenSettings, onPrint }) {
    return (
        <ActionMenu
            panelClassName={iconOnly
                ? "absolute top-full left-0 mt-1 w-56 rounded-lg border border-border bg-popover py-1 shadow-xl z-[90]"
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
                            onOpenExport();
                        }}
                        icon={<ExportIcon />}
                        label="Export review feedback"
                    />
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

function ToggleIcon({ name }) {
    const paths = {
        contents: "M4 6h16M4 10h16M4 14h10M4 18h10",
        versions: "M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
        view: "M2.25 12s3.75-6 9.75-6 9.75 6 9.75 6-3.75 6-9.75 6-9.75-6-9.75-6z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
        edit: "M16.862 4.487 19.5 7.125 8.25 18.375 5 19l.625-3.25L16.862 4.487z",
        changes: "M7 7h10M7 12h6M7 17h10",
        annotations: "M7 8h10M7 12h6m-8 8 3.5-4H19a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z",
        engineer: "M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4z",
        frontend: "M4 5h16v10H4z M8 19h8 M12 15v4",
        pair:
            "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20a5 5 0 0 1 10 0 M11 20a5 5 0 0 1 10 0",
        autonomous:
            "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1 M12 9l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.2-2.4 1.2.5-2.6-1.9-1.8 2.6-.4L12 9z",
    };
    return (
        <svg
            aria-hidden="true"
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
        >
            <path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} />
        </svg>
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

function PanelCollapseIcon({ side }) {
    const path = side === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
            <path d="M5 4v16" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M19 4v16" strokeWidth="1.5" strokeLinecap="round" />
            <path d={path} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
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

function ExportIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
        </svg>
    );
}

function FileIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
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

function reviewOutcomeCopy(submitted, classification, sessionLabel) {
    const target = sessionLabel || "the Session";
    if (submitted === "feedback") {
        return {
            title: "Feedback sent",
            subtitle: `RunWield will return to ${target} so the Planner or Architect can revise this Plan.`,
        };
    }
    if (submitted === "approved-later") {
        return {
            title: "Approved for later",
            subtitle: classification === "PROJECT"
                ? "This Epic is approved and saved for later decomposition."
                : "This Plan is approved and saved for later execution.",
        };
    }
    if (submitted === "approved-decompose") {
        return { title: "Approved & Slice", subtitle: `RunWield will return to ${target} and start Slicer handoff.` };
    }
    if (submitted === "approved-run") {
        return { title: "Approved & Run", subtitle: `RunWield will return to ${target} and start execution handoff.` };
    }
    return { title: "Review decision sent", subtitle: `RunWield will return to ${target}.` };
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

function readEmbeddedPayload(name) {
    const node = document.querySelector(`script[data-${name}]`);
    if (!node?.textContent) return null;
    try {
        return JSON.parse(node.textContent);
    } catch {
        return null;
    }
}
