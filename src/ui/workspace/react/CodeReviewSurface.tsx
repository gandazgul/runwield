// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DockviewReact } from "dockview-react";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider.tsx";
import { TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { ApproveButton, ExitButton, FeedbackButton } from "@plannotator/ui/components/ToolbarButtons.tsx";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";
import { DiffViewer } from "../../../../third_party/plannotator/packages/review-editor/components/DiffViewer.tsx";
import { FileHeader } from "../../../../third_party/plannotator/packages/review-editor/components/FileHeader.tsx";
import { FileTree } from "../../../../third_party/plannotator/packages/review-editor/components/FileTree.tsx";
import { ReviewSidebar } from "../../../../third_party/plannotator/packages/review-editor/components/ReviewSidebar.tsx";
import {
    buildReviewSubmission,
    ReviewSubmissionDialog,
} from "../../../../third_party/plannotator/packages/review-editor/components/ReviewSubmissionDialog.tsx";
import { SectionsPanel } from "../../../../third_party/plannotator/packages/review-editor/components/SectionsPanel.tsx";
import { parseDiffToFiles } from "../../../../third_party/plannotator/packages/review-editor/utils/diffParser.ts";
import "./plannotator.css";

const DEFAULT_CODE_PAYLOAD = { rawPatch: "", gitRef: "", agentCwd: "", token: "", mode: "dev", reviewStatus: null };

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
    const [feedback, setFeedback] = useState("");
    const [dialogAction, setDialogAction] = useState(null);
    const [submitted, setSubmitted] = useState(null);
    const [error, setError] = useState("");
    const [viewedFiles, setViewedFiles] = useState(new Set());
    const [dockApi, setDockApi] = useState(null);
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

    function addAnnotationForFile(
        file,
        type = "comment",
        text = "",
        suggestedCode,
        originalCode,
        conventionalLabel,
        decorations,
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
            createdAt: Date.now(),
        };
        setAnnotations((items) => [...items, next]);
        setSelectedAnnotationId(next.id);
    }

    async function confirmDecision() {
        const approved = dialogAction === "approve";
        await submit("feedback", { approved, feedback, annotations: toWorkflowAnnotations(annotations) });
        setDialogAction(null);
        setSubmitted(approved ? "approved" : "feedback");
    }

    async function submitExit() {
        await submit("exit", { reviewType: "code" });
        setSubmitted("exited");
    }

    const currentDiffPaths = useMemo(() => new Set(files.map((file) => file.path)), [files]);
    const submission = useMemo(
        () => buildReviewSubmission(annotations, [], undefined, currentDiffPaths),
        [annotations, currentDiffPaths],
    );
    const dockComponents = useMemo(() => ({
        diff: ({ params }) => {
            const file = files.find((item) => item.path === params?.filePath) || currentFile;
            if (!file) return <div className="rw-empty-diff">No diff content.</div>;
            return (
                <DiffPanel
                    file={file}
                    annotations={annotations}
                    selectedAnnotationId={selectedAnnotationId}
                    scrollTargetAnnotation={scrollTargetAnnotation}
                    pendingSelection={pendingSelection}
                    onLineSelection={setPendingSelection}
                    onAddAnnotation={(...args) => addAnnotationForFile(file, ...args)}
                    onSelectAnnotation={setSelectedAnnotationId}
                    onDeleteAnnotation={(id) => setAnnotations((items) => items.filter((item) => item.id !== id))}
                    onEditAnnotation={(id, text) =>
                        setAnnotations((items) => items.map((item) => item.id === id ? { ...item, text } : item))}
                    isViewed={viewedFiles.has(file.path)}
                    onToggleViewed={() =>
                        setViewedFiles((items) => {
                            const next = new Set(items);
                            if (next.has(file.path)) next.delete(file.path);
                            else next.add(file.path);
                            return next;
                        })}
                />
            );
        },
    }), [files, currentFile, annotations, selectedAnnotationId, scrollTargetAnnotation, pendingSelection, viewedFiles]);
    const handleDockReady = useCallback((event) => {
        setDockApi(event.api);
        event.api.onDidActivePanelChange((panel) => {
            const filePath = panel?.params?.filePath;
            const index = files.findIndex((file) => file.path === filePath);
            if (index >= 0) setActiveFileIndex(index);
        });
        for (const [index, file] of files.entries()) {
            event.api.addPanel({
                id: `diff:${file.path}`,
                component: "diff",
                title: file.path,
                params: { filePath: file.path },
            });
            if (index === activeFileIndex) event.api.getPanel(`diff:${file.path}`)?.api.setActive();
        }
    }, [files, activeFileIndex]);

    useEffect(() => {
        if (!dockApi || !currentFile) return;
        dockApi.getPanel(`diff:${currentFile.path}`)?.api.setActive();
    }, [dockApi, currentFile]);

    return (
        <ThemeProvider defaultTheme="dark" defaultColorTheme="plannotator">
            <TooltipProvider>
                <div className="rw-plannotator-host rw-code-review" data-review-mode={initialPayload.mode}>
                    <header className="rw-plannotator-toolbar">
                        <div>
                            <p className="eyebrow">RunWield hosted Plannotator surface</p>
                            <h2>Code Review</h2>
                            <p className="muted">
                                {initialPayload.gitRef || "Working diff"} · {initialPayload.agentCwd || "workspace"}
                            </p>
                        </div>
                        <div className="rw-plannotator-actions">
                            <ApproveButton onClick={() => setDialogAction("approve")} />
                            <FeedbackButton onClick={() => setDialogAction("comment")} />
                            <ExitButton onClick={submitExit} />
                        </div>
                    </header>
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    <div className="rw-plannotator-code-layout">
                        <aside className="rw-review-file-tree">
                            <FileTree
                                files={files}
                                activeFileIndex={activeFileIndex}
                                onSelectFile={setActiveFileIndex}
                                annotations={annotations}
                                viewedFiles={viewedFiles}
                                stagedFiles={stagedFiles}
                                onToggleViewed={(filePath) =>
                                    setViewedFiles((items) => {
                                        const next = new Set(items);
                                        if (next.has(filePath)) next.delete(filePath);
                                        else next.add(filePath);
                                        return next;
                                    })}
                                onSelectDiff={() => {}}
                                activeDiffType="working"
                                onSelectPanelView={() => {}}
                            />
                            <SectionsPanel
                                files={files}
                                sections={sections}
                                activeFileIndex={activeFileIndex}
                                onSelectFile={setActiveFileIndex}
                                annotations={annotations}
                                viewedFiles={viewedFiles}
                                stagedFiles={stagedFiles}
                                onSelectPanelView={() => {}}
                            />
                        </aside>
                        <main className="rw-review-dock-host" aria-label="Diff panels">
                            {currentFile
                                ? (
                                    <DockviewReact
                                        className="rw-dockview dockview-theme-dark"
                                        components={dockComponents}
                                        onReady={handleDockReady}
                                        disableFloatingGroups
                                    />
                                )
                                : <div className="rw-empty-diff">No diff content.</div>}
                        </main>
                        <ReviewSidebar
                            isOpen
                            onClose={() => {}}
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
                            feedbackMarkdown={feedback}
                            activeFilePath={currentFile?.path}
                        />
                    </div>
                    <label className="rw-hidden-feedback">
                        General feedback
                        <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} />
                    </label>
                    <ReviewSubmissionDialog
                        isOpen={!!dialogAction}
                        action={dialogAction || "comment"}
                        submission={submission}
                        generalComment={feedback}
                        onGeneralCommentChange={setFeedback}
                        platformOpenPR={false}
                        onPlatformOpenPRChange={() => {}}
                        onConfirm={confirmDecision}
                        onCancel={() => setDialogAction(null)}
                        isSubmitting={false}
                        mrLabel="review"
                        platformLabel="RunWield"
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

function DiffPanel({
    file,
    annotations,
    selectedAnnotationId,
    scrollTargetAnnotation,
    pendingSelection,
    onLineSelection,
    onAddAnnotation,
    onSelectAnnotation,
    onDeleteAnnotation,
    onEditAnnotation,
    isViewed,
    onToggleViewed,
}) {
    return (
        <section className="rw-plannotator-diff-panel">
            <FileHeader
                filePath={file.path}
                oldPath={file.oldPath}
                patch={file.patch}
                status={file.status}
                isViewed={isViewed}
                onToggleViewed={onToggleViewed}
            />
            <DiffViewer
                patch={file.patch}
                filePath={file.path}
                oldPath={file.oldPath}
                status={file.status}
                diffStyle="split"
                diffOverflow="scroll"
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                scrollTargetAnnotation={scrollTargetAnnotation}
                pendingSelection={pendingSelection}
                onLineSelection={onLineSelection}
                onAddAnnotation={onAddAnnotation}
                onAddFileComment={(text) => onAddAnnotation("comment", text)}
                onEditAnnotation={onEditAnnotation}
                onSelectAnnotation={onSelectAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                isViewed={isViewed}
                onToggleViewed={onToggleViewed}
            />
        </section>
    );
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
                : isStaged
                ? "staged"
                : unstaged.has(file.path)
                ? "unstaged"
                : "committed";
            return [file.path, { group, staged: isStaged }];
        })),
    };
}

function toWorkflowAnnotations(annotations) {
    return annotations.map((annotation) => ({
        id: annotation.id,
        file: annotation.filePath,
        path: annotation.filePath,
        filePath: annotation.filePath,
        line: annotation.lineStart,
        side: annotation.side,
        comment: annotation.text || "",
    }));
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
