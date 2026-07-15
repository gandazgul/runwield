// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider.tsx";
import { TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { ApproveButton, FeedbackButton } from "@plannotator/ui/components/ToolbarButtons.tsx";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";
import { ActionMenu, ActionMenuItem } from "@plannotator/ui/components/ActionMenu.tsx";
import { CommentPopover } from "@plannotator/ui/components/CommentPopover.tsx";
import { useConfigValue } from "@plannotator/ui/config/index.ts";
import { AllFilesCodeView } from "../../../../third_party/plannotator/packages/review-editor/components/AllFilesCodeView.tsx";
import { FileTree } from "../../../../third_party/plannotator/packages/review-editor/components/FileTree.tsx";
import { ReviewSidebar } from "../../../../third_party/plannotator/packages/review-editor/components/ReviewSidebar.tsx";
import { SectionsPanel } from "../../../../third_party/plannotator/packages/review-editor/components/SectionsPanel.tsx";
import { parseDiffToFiles } from "../../../../third_party/plannotator/packages/review-editor/utils/diffParser.ts";
import { exportReviewFeedback } from "../../../../third_party/plannotator/packages/review-editor/utils/exportFeedback.ts";
import { PlanReviewSettings } from "./PlanReviewSettings.tsx";
import "./plannotator.css";

const DEFAULT_CODE_PAYLOAD = {
    rawPatch: "",
    gitRef: "",
    agentCwd: "",
    token: "",
    mode: "dev",
    reviewStatus: null,
    guidedReview: null,
};

async function waitForGuideJob(jobId, token, setGuideJob) {
    const started = Date.now();
    while (Date.now() - started < 120000) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
        const response = await fetch(`/api/agents/jobs?token=${encodeURIComponent(token)}`, {
            headers: { "x-runwield-review-token": token },
        });
        if (!response.ok) throw new Error(await response.text() || `Guide job status failed: ${response.status}`);
        const data = await response.json();
        const job = (data.jobs || []).find((candidate) => candidate.id === jobId);
        if (job) {
            setGuideJob(job);
            if (["done", "failed", "killed"].includes(job.status)) return job;
        }
    }
    throw new Error("Timed out waiting for Guided Review generation.");
}

export function CodeReviewSurface({ payload }) {
    const initialPayload = useMemo(
        () => payload || readEmbeddedPayload("code-review-payload") || DEFAULT_CODE_PAYLOAD,
        [payload],
    );
    const files = useMemo(() => parseDiffToFiles(initialPayload.rawPatch || ""), [initialPayload.rawPatch]);
    const [activeFileIndex, setActiveFileIndex] = useState(0);
    const [annotations, setAnnotations] = useState([]);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
    const [scrollTargetAnnotation, setScrollTargetAnnotation] = useState(null);
    const [pendingSelection, setPendingSelection] = useState(null);
    const [globalCommentOpen, setGlobalCommentOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [fileTreeOpen, setFileTreeOpen] = useState(true);
    const [filePanelMode, setFilePanelMode] = useState("changes");
    const [annotationsOpen, setAnnotationsOpen] = useState(true);
    const [submitting, setSubmitting] = useState(null);
    const [submitted, setSubmitted] = useState(null);
    const [error, setError] = useState("");
    const [viewedFiles, setViewedFiles] = useState(new Set());
    const [fileNavigationTarget, setFileNavigationTarget] = useState(null);
    const [allFilesContentFits, setAllFilesContentFits] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const [guideJob, setGuideJob] = useState(null);
    const [guideCapabilities, setGuideCapabilities] = useState(initialPayload.devGuideCapabilities || null);
    const [guide, setGuide] = useState(initialPayload.guidedReviewFixture || null);
    const [guideGenerating, setGuideGenerating] = useState(false);
    const [guideError, setGuideError] = useState("");
    const autoGuideStartedRef = useRef(false);
    const globalCommentButtonRef = useRef(null);
    const allFilesHostRef = useRef(null);
    const navigationLockRef = useRef(null);
    const diffStyle = useConfigValue("diffStyle") || "split";
    const diffOverflow = useConfigValue("diffOverflow") || "scroll";
    const diffIndicators = useConfigValue("diffIndicators") || "bars";
    const diffLineDiffType = useConfigValue("diffLineDiffType") || "word-alt";
    const diffShowLineNumbers = useConfigValue("diffShowLineNumbers") !== false;
    const diffShowBackground = useConfigValue("diffShowBackground") !== false;
    const diffExpandUnchanged = useConfigValue("diffExpandUnchanged") === true;
    const diffFontFamily = useConfigValue("diffFontFamily") || undefined;
    const diffFontSize = useConfigValue("diffFontSize") || undefined;
    const currentFile = files[activeFileIndex] || files[0] || null;
    const sections = useMemo(
        () => buildReviewSections(files, initialPayload.reviewStatus),
        [files, initialPayload.reviewStatus],
    );
    const stagedFiles = useMemo(() =>
        new Set(
            Object.entries(sections.files)
                .filter(([, entry]) => entry?.staged === true)
                .map(([filePath]) => filePath),
        ), [sections]);
    const accordionFiles = useMemo(
        () => filePanelMode === "changes" ? orderFilesForChanges(files, sections, stagedFiles) : files,
        [filePanelMode, files, sections, stagedFiles],
    );
    const feedbackMarkdown = useMemo(
        () => annotations.length > 0 ? exportReviewFeedbackWithImages(annotations) : "",
        [annotations],
    );
    const guidePolicy = initialPayload.guidedReview ||
        { mode: "auto", autoStart: false, manualAvailable: true, reasons: [] };
    const guideReady = Boolean(guide);
    const guideCapabilitiesKnown = initialPayload.mode === "dev" || guideCapabilities !== null;
    const guideProviderAvailable = initialPayload.mode === "dev"
        ? guideCapabilities?.available !== false
        : Boolean(guideCapabilities?.available);

    useEffect(() => {
        let canceled = false;
        if (!initialPayload.token || initialPayload.mode === "dev") return undefined;
        fetch(`/api/agents/capabilities?token=${encodeURIComponent(initialPayload.token)}`, {
            headers: { "x-runwield-review-token": initialPayload.token },
        }).then((response) => response.ok ? response.json() : null).then((capabilities) => {
            if (!canceled) setGuideCapabilities(capabilities);
        }).catch(() => {
            if (!canceled) setGuideCapabilities({ available: false, providers: [] });
        });
        return () => {
            canceled = true;
        };
    }, [initialPayload.mode, initialPayload.token]);

    const generateGuide = useCallback(async () => {
        if (guideGenerating) return;
        setGuideError("");
        setGuideGenerating(true);
        try {
            if (initialPayload.mode === "dev") {
                await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
                if (initialPayload.devGuideFailure) throw new Error(initialPayload.devGuideFailure);
                if (!initialPayload.guidedReviewFixture) throw new Error("No dev Guided Review fixture is configured.");
                setGuide(initialPayload.guidedReviewFixture);
                setGuideJob({ id: "dev-guide", provider: "guide", status: "done", label: "Guided Review Explainer" });
                return;
            }
            const response = await fetch(`/api/agents/jobs?token=${encodeURIComponent(initialPayload.token)}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-review-token": initialPayload.token,
                },
                body: JSON.stringify({ provider: "guide", label: "Guided Review Explainer" }),
            });
            if (!response.ok) throw new Error(await response.text() || `Guide launch failed: ${response.status}`);
            const data = await response.json();
            const job = data.job;
            setGuideJob(job);
            const readyJob = await waitForGuideJob(job.id, initialPayload.token, setGuideJob);
            if (readyJob.status !== "done") throw new Error(readyJob.error || `Guide generation ${readyJob.status}`);
            const guideResponse = await fetch(
                `/api/guide/${encodeURIComponent(job.id)}?token=${encodeURIComponent(initialPayload.token)}`,
                {
                    headers: { "x-runwield-review-token": initialPayload.token },
                },
            );
            if (!guideResponse.ok) {
                throw new Error(await guideResponse.text() || `Guide load failed: ${guideResponse.status}`);
            }
            setGuide(await guideResponse.json());
        } catch (err) {
            setGuideError(err instanceof Error ? err.message : String(err));
        } finally {
            setGuideGenerating(false);
        }
    }, [guideGenerating, initialPayload]);

    useEffect(() => {
        if (!guidePolicy.autoStart || autoGuideStartedRef.current || guideReady || !guideCapabilitiesKnown) return;
        if (!guideProviderAvailable) return;
        autoGuideStartedRef.current = true;
        void generateGuide();
    }, [generateGuide, guideCapabilitiesKnown, guidePolicy.autoStart, guideProviderAvailable, guideReady]);

    const toggleViewedFile = useCallback((filePath) => {
        const wasViewed = viewedFiles.has(filePath);
        setViewedFiles((items) => {
            const next = new Set(items);
            if (next.has(filePath)) next.delete(filePath);
            else next.add(filePath);
            return next;
        });
        if (!wasViewed) return;

        const file = files.find((item) => item.path === filePath);
        if (!file) return;
        const scrollport = allFilesHostRef.current?.querySelector(".overflow-y-auto");
        setFileNavigationTarget({
            ...buildFileNavigationTarget(file),
            preserveScroll: true,
            scrollTop: scrollport?.scrollTop ?? 0,
        });
    }, [files, viewedFiles]);

    const navigateToFile = useCallback((index) => {
        const file = files[index];
        if (!file) return;
        navigationLockRef.current = file.path;
        setActiveFileIndex(index);
        setPendingSelection(null);
        setFileNavigationTarget(buildFileNavigationTarget(file));
    }, [files]);

    const handleVisibleFileChange = useCallback((filePath) => {
        if (navigationLockRef.current && navigationLockRef.current !== filePath) return;
        const index = files.findIndex((file) => file.path === filePath);
        if (index >= 0) setActiveFileIndex(index);
    }, [files]);

    useEffect(() => {
        if (!fileNavigationTarget) return;

        if (fileNavigationTarget.preserveScroll) {
            const scrollport = allFilesHostRef.current?.querySelector(".overflow-y-auto");
            if (!scrollport) return;
            const scrollTop = fileNavigationTarget.scrollTop;
            let frame;
            let attempts = 0;

            const preservePosition = () => {
                scrollport.scrollTop = scrollTop;
                if (attempts++ < 3) {
                    frame = requestAnimationFrame(preservePosition);
                    return;
                }
                setFileNavigationTarget((target) => target?.id === fileNavigationTarget.id ? null : target);
            };

            frame = requestAnimationFrame(preservePosition);
            return () => cancelAnimationFrame(frame);
        }

        let canceled = false;
        let timer;
        let attempts = 0;

        const alignSelectedFile = () => {
            if (canceled) return;
            const host = allFilesHostRef.current;
            const scrollport = host?.querySelector(".overflow-y-auto");
            const header = Array.from(host?.querySelectorAll("[slot='header-custom']") || [])
                .find((node) => node.textContent?.includes(fileNavigationTarget.filePath));

            if (!scrollport || !header) {
                if (attempts++ < 20) timer = globalThis.setTimeout(alignSelectedFile, 25);
                return;
            }

            const offset = header.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
            if (Math.abs(offset) > 1) scrollport.scrollTop += offset;
            const index = files.findIndex((file) => file.path === fileNavigationTarget.filePath);
            if (index >= 0) setActiveFileIndex(index);
            timer = globalThis.setTimeout(() => {
                if (navigationLockRef.current === fileNavigationTarget.filePath) {
                    navigationLockRef.current = null;
                }
            }, 150);
        };

        timer = globalThis.setTimeout(alignSelectedFile, 50);
        return () => {
            canceled = true;
            globalThis.clearTimeout(timer);
        };
    }, [fileNavigationTarget, files]);

    useEffect(() => {
        let canceled = false;
        let observer;
        let timer;

        const connect = () => {
            if (canceled) return;
            const scrollport = allFilesHostRef.current?.querySelector(".overflow-y-auto");
            const content = scrollport?.firstElementChild;
            if (!scrollport || !content) {
                timer = globalThis.setTimeout(connect, 25);
                return;
            }

            const update = () => {
                const fits = content.getBoundingClientRect().height <= scrollport.clientHeight;
                setAllFilesContentFits(fits);
            };
            observer = new ResizeObserver(update);
            observer.observe(scrollport);
            observer.observe(content);
            update();
        };

        connect();
        return () => {
            canceled = true;
            globalThis.clearTimeout(timer);
            observer?.disconnect();
        };
    }, [
        files,
        filePanelMode,
        diffStyle,
        diffOverflow,
        diffIndicators,
        diffLineDiffType,
        diffShowLineNumbers,
        diffShowBackground,
        diffExpandUnchanged,
        diffFontFamily,
        diffFontSize,
    ]);

    function addAnnotationForFile(
        file,
        type = "comment",
        text = "",
        suggestedCode,
        originalCode,
        conventionalLabel,
        decorations,
        tokenMeta,
    ) {
        if (!file) return;
        const range = pendingSelection || { start: 1, end: 1, side: "additions" };
        const next = {
            id: crypto.randomUUID(),
            type,
            scope: "line",
            filePath: file.path,
            lineStart: range.start,
            lineEnd: range.end,
            side: range.side === "deletions" ? "old" : "new",
            text,
            suggestedCode,
            originalCode,
            conventionalLabel,
            decorations,
            ...(tokenMeta && {
                charStart: tokenMeta.charStart,
                charEnd: tokenMeta.charEnd,
                tokenText: tokenMeta.tokenText,
            }),
            createdAt: Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(next.id);
        setPendingSelection(null);
    }

    function addFileComment(filePath, text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const next = {
            id: crypto.randomUUID(),
            type: "comment",
            scope: "file",
            filePath,
            lineStart: 1,
            lineEnd: 1,
            side: "new",
            text: trimmed,
            createdAt: Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(next.id);
    }

    function editAnnotation(id, text, suggestedCode, originalCode, conventionalLabel, decorations) {
        setAnnotations((items) =>
            items.map((item) =>
                item.id === id
                    ? {
                        ...item,
                        ...(text !== undefined && { text }),
                        ...(suggestedCode !== undefined && { suggestedCode }),
                        ...(originalCode !== undefined && { originalCode }),
                        ...(conventionalLabel !== undefined && {
                            conventionalLabel: conventionalLabel ?? undefined,
                        }),
                        ...(decorations !== undefined && { decorations }),
                    }
                    : item
            )
        );
    }

    function addGlobalComment(text, images) {
        const next = {
            id: crypto.randomUUID(),
            type: "comment",
            scope: "general",
            filePath: "",
            lineStart: 0,
            lineEnd: 0,
            side: "new",
            text,
            ...(images?.length ? { images } : {}),
            createdAt: Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(next.id);
        setGlobalCommentOpen(false);
    }

    function buildReviewPayload() {
        const workflowAnnotations = toWorkflowAnnotations(annotations);
        return {
            feedback: feedbackMarkdown,
            annotations: workflowAnnotations,
        };
    }

    async function submitApprove() {
        setSubmitting("approve");
        try {
            await submit("feedback", { approved: true, ...buildReviewPayload() });
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
            await submit("feedback", { approved: false, ...buildReviewPayload() });
            setSubmitted("feedback");
        } catch {
            // submit() owns the visible error state.
        } finally {
            setSubmitting(null);
        }
    }

    return (
        <ThemeProvider
            defaultTheme="dark"
            defaultColorTheme="runwield"
            storageKey="runwield-review-theme-mode"
            colorThemeStorageKey="runwield-review-color-theme"
        >
            <TooltipProvider>
                <div className="rw-plannotator-host rw-code-review" data-review-mode={initialPayload.mode}>
                    <header className="rw-plannotator-toolbar">
                        <div className="rw-plan-review-heading">
                            <img src="/logo.svg" alt="" aria-hidden="true" />
                            <h1>Code Review</h1>
                            {initialPayload.mode === "dev" && (
                                <p className="rw-plan-review-dev-notice" role="status">
                                    DEV MODE — Feedback and approval won’t go anywhere.
                                </p>
                            )}
                        </div>
                        <div className="rw-plannotator-actions">
                            <CodeReviewOptionsMenu
                                annotationsOpen={annotationsOpen}
                                fileTreeOpen={fileTreeOpen}
                                onOpenSettings={() => setSettingsOpen(true)}
                                onPrint={() => globalThis.print?.()}
                                onToggleAnnotations={() => setAnnotationsOpen((open) => !open)}
                                onToggleFileTree={() => setFileTreeOpen((open) => !open)}
                            />
                            <FeedbackButton
                                onClick={submitFeedback}
                                disabled={annotations.length === 0 || submitting !== null}
                                isLoading={submitting === "feedback"}
                                title={annotations.length === 0
                                    ? "Add an annotation before sending feedback"
                                    : "Send all annotations"}
                            />
                            <ApproveButton
                                onClick={submitApprove}
                                disabled={submitting !== null}
                                isLoading={submitting === "approve"}
                            />
                        </div>
                    </header>
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    <div className="rw-code-review-controls">
                        <p
                            title={`${initialPayload.gitRef || "Working diff"} · ${
                                initialPayload.agentCwd || "workspace"
                            }`}
                        >
                            {initialPayload.gitRef || "Working diff"}
                        </p>
                        <div className="rw-guide-actions">
                            <button
                                className="rw-code-control-button rw-guide-generate-button"
                                type="button"
                                onClick={guideReady ? () => setGuideOpen((open) => !open) : generateGuide}
                                disabled={guideGenerating || (!guideReady && !guideProviderAvailable)}
                                title="Guided Review generation uses an additional LLM call when backed by an agent provider."
                            >
                                {guideGenerating
                                    ? "Generating guided review…"
                                    : guideReady
                                    ? (guideOpen ? "Back to diff" : "Guided Review ready")
                                    : "Generate guided review"}
                            </button>
                            <span className="rw-guide-cost-note">
                                {formatGuideStatus(guideJob, guideCapabilities, guidePolicy)}
                            </span>
                        </div>
                        <button
                            ref={globalCommentButtonRef}
                            className="rw-code-control-button"
                            type="button"
                            onClick={() => setGlobalCommentOpen((open) => !open)}
                        >
                            <CommentIcon />
                            Global comment
                        </button>
                    </div>
                    <div
                        className="rw-plannotator-code-layout"
                        data-annotations-open={annotationsOpen}
                        data-file-tree-open={fileTreeOpen}
                    >
                        {fileTreeOpen && (
                            <aside className="rw-review-file-tree">
                                <div className="rw-code-file-tabs" role="tablist" aria-label="Code review files">
                                    <button
                                        aria-selected={filePanelMode === "changes"}
                                        className={filePanelMode === "changes" ? "active" : ""}
                                        onClick={() => setFilePanelMode("changes")}
                                        role="tab"
                                        type="button"
                                    >
                                        Changes
                                    </button>
                                    <button
                                        aria-selected={filePanelMode === "tree"}
                                        className={filePanelMode === "tree" ? "active" : ""}
                                        onClick={() => setFilePanelMode("tree")}
                                        role="tab"
                                        type="button"
                                    >
                                        Files
                                    </button>
                                </div>
                                <div className="rw-code-file-panel">
                                    {filePanelMode === "tree"
                                        ? (
                                            <FileTree
                                                files={files}
                                                activeFileIndex={activeFileIndex}
                                                scrollHighlightIndex={activeFileIndex}
                                                onSelectFile={navigateToFile}
                                                annotations={annotations}
                                                viewedFiles={viewedFiles}
                                                stagedFiles={stagedFiles}
                                                onToggleViewed={toggleViewedFile}
                                                onSelectDiff={() => {}}
                                                activeDiffType="working"
                                                onSelectPanelView={() => {}}
                                            />
                                        )
                                        : (
                                            <SectionsPanel
                                                files={files}
                                                sections={sections}
                                                activeFileIndex={activeFileIndex}
                                                scrollHighlightIndex={activeFileIndex}
                                                onSelectFile={navigateToFile}
                                                annotations={annotations}
                                                viewedFiles={viewedFiles}
                                                stagedFiles={stagedFiles}
                                                onToggleViewed={toggleViewedFile}
                                                onSelectPanelView={() => {}}
                                            />
                                        )}
                                </div>
                            </aside>
                        )}
                        <main
                            ref={allFilesHostRef}
                            className="rw-review-all-files-host"
                            aria-label="All file changes"
                            data-content-fits={allFilesContentFits}
                        >
                            {guideOpen && guide
                                ? (
                                    <GuidedReviewExplainer
                                        guide={guide}
                                        files={files}
                                        token={initialPayload.token}
                                        jobId={guideJob?.id || "dev-guide"}
                                        diffProps={{
                                            diffStyle,
                                            diffOverflow,
                                            diffIndicators,
                                            diffLineDiffType,
                                            diffShowLineNumbers,
                                            diffShowBackground,
                                            diffExpandUnchanged,
                                            diffFontFamily,
                                            diffFontSize,
                                            annotations,
                                            selectedAnnotationId,
                                            scrollTargetAnnotation,
                                            pendingSelection,
                                            setPendingSelection,
                                            addAnnotationForFile,
                                            editAnnotation,
                                            setSelectedAnnotationId,
                                            setAnnotations,
                                            addFileComment,
                                            viewedFiles,
                                            toggleViewedFile,
                                            stagedFiles,
                                        }}
                                    />
                                )
                                : files.length > 0
                                ? (
                                    <AllFilesCodeView
                                        key={[
                                            diffStyle,
                                            diffOverflow,
                                            diffIndicators,
                                            diffLineDiffType,
                                            diffShowLineNumbers,
                                            diffShowBackground,
                                            diffExpandUnchanged,
                                            diffFontFamily,
                                            diffFontSize,
                                        ].join("|")}
                                        files={accordionFiles}
                                        diffStyle={diffStyle}
                                        diffOverflow={diffOverflow}
                                        diffIndicators={diffIndicators}
                                        lineDiffType={diffLineDiffType}
                                        disableLineNumbers={!diffShowLineNumbers}
                                        disableBackground={!diffShowBackground}
                                        expandUnchanged={diffExpandUnchanged}
                                        fontFamily={diffFontFamily}
                                        fontSize={diffFontSize}
                                        annotations={annotations}
                                        selectedAnnotationId={selectedAnnotationId}
                                        scrollTargetAnnotation={scrollTargetAnnotation}
                                        pendingSelection={pendingSelection}
                                        onLineSelection={setPendingSelection}
                                        onAddAnnotationForFile={(filePath, ...args) =>
                                            addAnnotationForFile(
                                                files.find((file) => file.path === filePath),
                                                ...args,
                                            )}
                                        onEditAnnotation={editAnnotation}
                                        onSelectAnnotation={setSelectedAnnotationId}
                                        onDeleteAnnotation={(id) =>
                                            setAnnotations((items) => items.filter((item) => item.id !== id))}
                                        onAddFileCommentForFile={addFileComment}
                                        viewedFiles={viewedFiles}
                                        onToggleViewed={toggleViewedFile}
                                        stagedFiles={stagedFiles}
                                        activeSearchMatchId={fileNavigationTarget?.id ?? null}
                                        activeSearchMatch={fileNavigationTarget}
                                        onVisibleFileChange={handleVisibleFileChange}
                                        fileOrder={filePanelMode === "tree" ? "tree" : "list"}
                                        isActive
                                    />
                                )
                                : <div className="rw-empty-diff">No diff content.</div>}
                            {guideError && <p className="rw-review-error" role="alert">{guideError}</p>}
                        </main>
                        {annotationsOpen && (
                            <ReviewSidebar
                                isOpen
                                width={352}
                                onClose={() => setAnnotationsOpen(false)}
                                activeTab="annotations"
                                annotations={annotations}
                                files={files}
                                selectedAnnotationId={selectedAnnotationId}
                                onSelectAnnotation={setSelectedAnnotationId}
                                onNavigateToAnnotation={(id) => {
                                    setSelectedAnnotationId(id);
                                    if (id) setScrollTargetAnnotation({ id, token: Date.now() });
                                }}
                                onDeleteAnnotation={(id) =>
                                    setAnnotations((items) => items.filter((item) => item.id !== id))}
                                feedbackMarkdown={feedbackMarkdown}
                                activeFilePath={currentFile?.path}
                            />
                        )}
                    </div>
                    {globalCommentOpen && globalCommentButtonRef.current && (
                        <CommentPopover
                            anchorEl={globalCommentButtonRef.current}
                            contextText="Code review"
                            draftKey={`code-review:${initialPayload.token}:global`}
                            isGlobal
                            onSubmit={addGlobalComment}
                            onClose={() => setGlobalCommentOpen(false)}
                        />
                    )}
                    <PlanReviewSettings
                        mode="code"
                        open={settingsOpen}
                        onClose={() => setSettingsOpen(false)}
                    />
                    <CompletionOverlay
                        submitted={submitted}
                        title={submitted === "approved" ? "Changes approved" : "Feedback sent"}
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
            console.log("Code review dev decision", { endpoint, body });
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

function formatGuideStatus(job, capabilities, policy) {
    if (job) {
        const elapsed = typeof job.elapsedMs === "number" ? `${(job.elapsedMs / 1000).toFixed(1)}s` : "elapsed pending";
        const model = [job.providerName || job.engine || job.provider, job.model].filter(Boolean).join("/") ||
            "provider unknown";
        const tokens = job.tokens ? `tokens ${JSON.stringify(job.tokens)}` : "tokens unavailable";
        const cost = job.cost ? `cost ${JSON.stringify(job.cost)}` : "cost unavailable";
        return `${job.status} · ${model} · ${elapsed} · ${tokens} · ${cost}`;
    }
    if (capabilities && !capabilities.available) {
        return "Guided Review provider unavailable · configure provider to make the extra LLM call";
    }
    return `extra LLM call · ${policy.reasons?.join(", ") || policy.mode || "manual"} · cost unavailable until run`;
}

function GuidedReviewExplainer({ guide, files, token, jobId, diffProps }) {
    const placed = new Set();
    return (
        <article className="rw-guide-explainer" aria-label="Guided Review Explainer">
            <header className="rw-guide-explainer-header">
                <p className="rw-guide-kicker">Guided Review Explainer</p>
                <h2>{guide.title || "Guided Review"}</h2>
                {guide.intent && <p>{guide.intent}</p>}
            </header>
            {(guide.sections || []).map((section, sectionIndex) => (
                <section className="rw-guide-section" key={`${section.title}:${sectionIndex}`}>
                    <h3>{section.title}</h3>
                    {section.role && <p className="rw-guide-section-role">{section.role}</p>}
                    {(section.blocks || []).map((block, blockIndex) => {
                        if (block.type === "diff" && block.file) {
                            placed.add(block.file);
                        }
                        return (
                            <GuideBlock
                                key={`${block.type}:${blockIndex}:${block.file || block.title || "block"}`}
                                block={block}
                                files={files}
                                token={token}
                                jobId={jobId}
                                diffProps={diffProps}
                            />
                        );
                    })}
                </section>
            ))}
            {(guide.everythingElse || []).length > 0 && (
                <section className="rw-guide-section">
                    <h3>Everything else</h3>
                    <p className="rw-guide-section-role">Changed files not placed in the explanatory flow.</p>
                    {guide.everythingElse.map((ref, index) => (
                        <GuideBlock
                            key={`everything:${ref.file}:${index}`}
                            block={{ type: "diff", file: ref.file, summary: "Additional changed file." }}
                            files={files}
                            token={token}
                            jobId={jobId}
                            diffProps={diffProps}
                        />
                    ))}
                </section>
            )}
        </article>
    );
}

function GuideBlock({ block, files, token, jobId: _jobId, diffProps }) {
    if (block.type === "prose") {
        return <div className="rw-guide-prose">{renderMarkdownLite(block.markdown || block.text || "")}</div>;
    }
    if (block.type === "callout") {
        return (
            <aside className={`rw-guide-callout rw-guide-callout-${block.tone || "note"}`}>
                {block.title && <strong>{block.title}</strong>}
                <div>{renderMarkdownLite(block.markdown || block.text || "")}</div>
            </aside>
        );
    }
    if (block.type === "mermaid") return <MermaidBlock block={block} />;
    if (block.type === "widget") {
        const id = encodeURIComponent(block.id || block.widgetId || "widget");
        const entry = encodeURIComponent(block.entry || "index.html");
        return (
            <figure className="rw-guide-widget">
                <figcaption>
                    <strong>{block.title || "Interactive explainer"}</strong>
                    {block.reason && <span>{block.reason}</span>}
                </figcaption>
                <iframe
                    title={block.title || "Guided Review widget"}
                    sandbox="allow-scripts"
                    src={`/api/review/widgets/${id}/${entry}?token=${encodeURIComponent(token)}`}
                />
            </figure>
        );
    }
    if (block.type === "reviewCheckpoint") {
        return <div className="rw-guide-checkpoint">{renderMarkdownLite(block.markdown || block.text || "")}</div>;
    }
    if (block.type === "diff" && block.file) {
        const file = files.find((item) => item.path === block.file);
        if (!file) return <p className="rw-guide-missing-diff">Diff no longer available: {block.file}</p>;
        return (
            <div className="rw-guide-diff-block">
                {block.summary && <p>{block.summary}</p>}
                <AllFilesCodeView
                    files={[file]}
                    diffStyle={diffProps.diffStyle}
                    diffOverflow={diffProps.diffOverflow}
                    diffIndicators={diffProps.diffIndicators}
                    lineDiffType={diffProps.diffLineDiffType}
                    disableLineNumbers={!diffProps.diffShowLineNumbers}
                    disableBackground={!diffProps.diffShowBackground}
                    expandUnchanged={diffProps.diffExpandUnchanged}
                    fontFamily={diffProps.diffFontFamily}
                    fontSize={diffProps.diffFontSize}
                    annotations={diffProps.annotations}
                    selectedAnnotationId={diffProps.selectedAnnotationId}
                    scrollTargetAnnotation={diffProps.scrollTargetAnnotation}
                    pendingSelection={diffProps.pendingSelection}
                    onLineSelection={diffProps.setPendingSelection}
                    onAddAnnotationForFile={(filePath, ...args) =>
                        diffProps.addAnnotationForFile(files.find((item) => item.path === filePath), ...args)}
                    onEditAnnotation={diffProps.editAnnotation}
                    onSelectAnnotation={diffProps.setSelectedAnnotationId}
                    onDeleteAnnotation={(id) =>
                        diffProps.setAnnotations((items) => items.filter((item) => item.id !== id))}
                    onAddFileCommentForFile={diffProps.addFileComment}
                    viewedFiles={diffProps.viewedFiles}
                    onToggleViewed={diffProps.toggleViewedFile}
                    stagedFiles={diffProps.stagedFiles}
                    fileOrder="list"
                    isActive
                />
            </div>
        );
    }
    return null;
}

function MermaidBlock({ block }) {
    const [svg, setSvg] = useState("");
    const [error, setError] = useState("");
    useEffect(() => {
        let canceled = false;
        import("mermaid").then(({ default: mermaid }) => {
            mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
            return mermaid.render(`guide-${crypto.randomUUID()}`, block.source || "flowchart TD\nA[Empty diagram]");
        }).then((result) => {
            if (!canceled) setSvg(result.svg || "");
        }).catch((err) => {
            if (!canceled) setError(err instanceof Error ? err.message : String(err));
        });
        return () => {
            canceled = true;
        };
    }, [block.source]);
    return (
        <figure className="rw-guide-mermaid">
            {block.title && (
                <figcaption>
                    <strong>{block.title}</strong>
                    {block.description && <span>{block.description}</span>}
                </figcaption>
            )}
            {error ? <pre>{error}</pre> : <div dangerouslySetInnerHTML={{ __html: svg }} />}
        </figure>
    );
}

function renderMarkdownLite(markdown) {
    return String(markdown).split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>);
}

function buildFileNavigationTarget(file) {
    const hunk = file.patch.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
    const isDeletion = file.status === "deleted";
    return {
        id: `file:${file.path}:${crypto.randomUUID()}`,
        filePath: file.path,
        side: isDeletion ? "deletion" : "addition",
        lineNumber: Number(hunk?.[isDeletion ? 1 : 2] || 1),
        text: "",
        matchStart: 0,
        matchEnd: 0,
        snippet: "",
    };
}

function buildReviewSections(files, reviewStatus) {
    const staged = new Set(Array.isArray(reviewStatus?.stagedFiles) ? reviewStatus.stagedFiles : []);
    const unstaged = new Set(Array.isArray(reviewStatus?.unstagedFiles) ? reviewStatus.unstagedFiles : []);
    const untracked = new Set(Array.isArray(reviewStatus?.untrackedFiles) ? reviewStatus.untrackedFiles : []);
    return {
        files: Object.fromEntries(files.map((file) => {
            const isStaged = staged.has(file.path);
            const group = untracked.has(file.path)
                ? "untracked"
                : isStaged || unstaged.has(file.path)
                ? "changes"
                : "committed";
            return [file.path, { group, staged: isStaged }];
        })),
    };
}

function orderFilesForChanges(files, sections, stagedFiles) {
    const grouped = {
        committed: [],
        changes: [],
        untracked: [],
    };

    files.forEach((file, index) => {
        const entry = sections.files[file.path];
        const staged = stagedFiles.has(file.path);
        let group = entry?.group ?? "committed";

        if (group === "untracked" && staged) {
            group = "changes";
        } else if (group === "changes" && entry?.staged && !staged && file.status === "added") {
            group = "untracked";
        }

        grouped[group].push({ file, index, staged });
    });

    grouped.changes.sort((left, right) => Number(right.staged) - Number(left.staged) || left.index - right.index);

    return [
        ...grouped.committed,
        ...grouped.changes,
        ...grouped.untracked,
    ].map(({ file }) => file);
}

function toWorkflowAnnotations(annotations) {
    return annotations.map((annotation) => ({
        ...annotation,
        file: annotation.filePath,
        path: annotation.filePath,
        line: annotation.lineStart,
        comment: annotation.text || "",
    }));
}

function exportReviewFeedbackWithImages(annotations) {
    const feedback = exportReviewFeedback(annotations);
    const references = annotations.flatMap((annotation) =>
        Array.isArray(annotation.images) ? annotation.images.map((image) => ({ annotation, image })) : []
    );
    if (references.length === 0) return feedback;

    const lines = references.map(({ annotation, image }) => {
        const scope = annotation.scope === "general"
            ? "Global comment"
            : `${annotation.filePath || "Code review"}:${annotation.lineStart || 1}`;
        return `- ${scope}: [${image.name || "image"}](${image.path})`;
    });
    return `${feedback}\n\n## Attached images\n\n${lines.join("\n")}`;
}

function CodeReviewOptionsMenu({
    annotationsOpen,
    fileTreeOpen,
    onOpenSettings,
    onPrint,
    onToggleAnnotations,
    onToggleFileTree,
}) {
    return (
        <ActionMenu
            renderTrigger={({ isOpen, toggleMenu }) => (
                <button
                    type="button"
                    onClick={toggleMenu}
                    className={`relative flex items-center gap-1.5 p-1.5 md:px-2.5 md:py-1 rounded-md text-xs font-medium transition-colors ${
                        isOpen
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title="Options"
                    aria-label="Options"
                    aria-expanded={isOpen}
                >
                    <MenuIcon />
                    <span className="hidden md:inline">Options</span>
                </button>
            )}
        >
            {({ closeMenu }) => (
                <>
                    <ActionMenuItem
                        onClick={() => {
                            closeMenu();
                            onToggleFileTree();
                        }}
                        icon={<FileTreeIcon />}
                        label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
                    />
                    <ActionMenuItem
                        onClick={() => {
                            closeMenu();
                            onToggleAnnotations();
                        }}
                        icon={<CommentIcon />}
                        label={annotationsOpen ? "Hide annotations" : "Show annotations"}
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

function MenuIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

function FileTreeIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h6l2 2h8v12H4z" />
        </svg>
    );
}

function CommentIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 8h10M7 12h6m-8 8 3.5-4H19a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"
            />
        </svg>
    );
}

function PrintIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8z"
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
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
        </svg>
    );
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
