// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useMemo, useRef, useState } from "react";
import { ThemeProvider, useTheme } from "@plannotator/ui/components/ThemeProvider.tsx";
import { TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { Viewer } from "@plannotator/ui/components/Viewer.tsx";
import { MarkdownEditor } from "@plannotator/ui/components/MarkdownEditor.tsx";
import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel.tsx";
import { AnnotationToolstrip } from "@plannotator/ui/components/AnnotationToolstrip.tsx";
import { ApproveDropdown } from "@plannotator/ui/components/ApproveDropdown.tsx";
import { ExitButton, FeedbackButton } from "@plannotator/ui/components/ToolbarButtons.tsx";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";
import { CommentPopover } from "@plannotator/ui/components/CommentPopover.tsx";
import { Settings } from "@plannotator/ui/components/Settings.tsx";
import {
    ActionMenu,
    ActionMenuDivider,
    ActionMenuItem,
    ActionMenuSectionLabel,
} from "@plannotator/ui/components/ActionMenu.tsx";
import { MoonIcon, SunIcon, SystemIcon } from "@plannotator/ui/components/icons/themeIcons.tsx";
import { OverlayScrollArea } from "@plannotator/ui/components/OverlayScrollArea.tsx";
import { ResizeHandle } from "@plannotator/ui/components/ResizeHandle.tsx";
import { SidebarContainer } from "@plannotator/ui/components/sidebar/SidebarContainer.tsx";
import { SidebarTabs } from "@plannotator/ui/components/sidebar/SidebarTabs.tsx";
import { usePrintMode } from "@plannotator/ui/hooks/usePrintMode.ts";
import { getAgentSwitchSettings, getEffectiveAgentName } from "@plannotator/ui/utils/agentSwitch.ts";
import { getPlanSaveSettings } from "@plannotator/ui/utils/planSave.ts";
import { extractFrontmatter, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser.ts";
import "./plannotator.css";

const DEFAULT_PLAN_PAYLOAD = { plan: "", token: "", mode: "dev" };
const REVIEW_AGENTS = [
    { id: "build", name: "Build" },
    { id: "engineer", name: "Engineer" },
    { id: "router", name: "Router" },
];

export function PlanReviewSurface({ payload }) {
    usePrintMode();
    const initialPayload = useMemo(() => payload || readEmbeddedPayload("review-payload") || DEFAULT_PLAN_PAYLOAD, [
        payload,
    ]);
    const [plan, setPlan] = useState(initialPayload.plan || "");
    const [editorMode, setEditorMode] = useState("view");
    const [annotationsOpen, setAnnotationsOpen] = useState(true);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [feedbackAnchor, setFeedbackAnchor] = useState(null);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [annotations, setAnnotations] = useState([]);
    const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
    const [activeSection, setActiveSection] = useState(null);
    const [feedback, setFeedback] = useState("");
    const [annotationMode, setAnnotationMode] = useState("comment");
    const [inputMethod, setInputMethod] = useState("drag");
    const [submitted, setSubmitted] = useState(null);
    const [error, setError] = useState("");
    const editorHandleRef = useRef(null);
    const parsed = useMemo(() => {
        const frontmatterResult = extractFrontmatter(plan);
        return {
            blocks: parseMarkdownToBlocks(plan),
            frontmatter: frontmatterResult.frontmatter,
        };
    }, [plan]);

    async function submitApprove() {
        const setting = getAgentSwitchSettings();
        await submit("decision", {
            approved: true,
            feedback: feedback || undefined,
            agentSwitch: getEffectiveAgentName(setting),
            ...buildPlanSavePayload(),
        });
        setSubmitted("approved");
    }

    async function submitExit() {
        await submit("exit", { reviewType: "plan" });
        setSubmitted("exited");
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
        setAnnotations((items) => items.filter((item) => item.id !== id));
    }

    function toggleCheckbox(blockId, checked) {
        const block = parsed.blocks.find((item) => item.id === blockId);
        if (!block || typeof block.startLine !== "number") return;
        setPlan((current) => toggleMarkdownCheckbox(current, block.startLine, checked));
    }

    function buildPlanSavePayload() {
        const planSaveSettings = getPlanSaveSettings();
        return {
            plan,
            planSave: {
                enabled: planSaveSettings.enabled,
                path: initialPayload.planPath,
                ...(planSaveSettings.customPath && { customPath: planSaveSettings.customPath }),
            },
        };
    }

    return (
        <ThemeProvider defaultTheme="dark" defaultColorTheme="plannotator">
            <TooltipProvider>
                <div className="rw-plannotator-host rw-plan-review" data-review-mode={initialPayload.mode}>
                    <header className="rw-plannotator-toolbar">
                        <div>
                            <p className="eyebrow">RunWield hosted Plannotator surface</p>
                            <h2>Plan Review</h2>
                        </div>
                        <div className="rw-plannotator-actions">
                            <PlanReviewOptionsMenu
                                onOpenSettings={() => setSettingsOpen(true)}
                                onPrint={() => globalThis.print?.()}
                            />
                            <span ref={setFeedbackAnchor}>
                                <FeedbackButton onClick={() => setFeedbackOpen(true)} />
                            </span>
                            <ApproveDropdown onApprove={submitApprove} agents={REVIEW_AGENTS} />
                            <ExitButton onClick={submitExit} />
                        </div>
                    </header>
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    <div className="rw-plannotator-plan-layout">
                        <SidebarTabs
                            activeTab="toc"
                            onToggleTab={() => {}}
                            hasDiff={false}
                            showFilesTab={false}
                            showVersionsTab={false}
                            showMessagesTab={false}
                            showAgentTerminalTab={false}
                        />
                        <SidebarContainer
                            activeTab="toc"
                            onTabChange={() => {}}
                            onClose={() => {}}
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
                        <ResizeHandle orientation="vertical" />
                        <main className="rw-plannotator-main-pane">
                            <div className="rw-document-mode-toggle" role="tablist" aria-label="Plan review mode">
                                <button
                                    className={editorMode === "view" ? "active" : ""}
                                    type="button"
                                    onClick={() => setEditorMode("view")}
                                >
                                    Viewer
                                </button>
                                <button
                                    className={editorMode === "edit" ? "active" : ""}
                                    type="button"
                                    onClick={() => setEditorMode("edit")}
                                >
                                    MarkdownEditor
                                </button>
                            </div>
                            <OverlayScrollArea className="rw-plannotator-scroll-area">
                                {editorMode === "view"
                                    ? (
                                        <Viewer
                                            blocks={parsed.blocks}
                                            markdown={plan}
                                            frontmatter={parsed.frontmatter}
                                            annotations={annotations}
                                            onAddAnnotation={addAnnotation}
                                            onSelectAnnotation={setSelectedAnnotationId}
                                            selectedAnnotationId={selectedAnnotationId}
                                            mode="comment"
                                            taterMode={false}
                                            stickyActions
                                            gridEnabled
                                            imageBaseDir={initialPayload.imageBaseDir}
                                            onToggleCheckbox={toggleCheckbox}
                                        />
                                    )
                                    : (
                                        <MarkdownEditor
                                            markdown={plan}
                                            documentId={initialPayload.token || "dev-plan"}
                                            editorHandleRef={editorHandleRef}
                                            onMarkdownChange={setPlan}
                                            gridEnabled
                                        />
                                    )}
                            </OverlayScrollArea>
                            <AnnotationToolstrip
                                inputMethod={inputMethod}
                                onInputMethodChange={setInputMethod}
                                mode={annotationMode}
                                onModeChange={setAnnotationMode}
                                taterMode={false}
                                compact
                            />
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
                    {feedbackOpen && feedbackAnchor && (
                        <CommentPopover
                            anchorEl={feedbackAnchor}
                            contextText="Plan feedback"
                            isGlobal
                            initialText={feedback}
                            onDraftChange={(text) => setFeedback(text)}
                            onSubmit={(text) => {
                                setFeedback(text);
                                submit("deny", { feedback: text, ...buildPlanSavePayload() }).then(() => {
                                    setFeedbackOpen(false);
                                    setSubmitted("feedback");
                                });
                            }}
                            onClose={() => setFeedbackOpen(false)}
                            draftKey={`plan-feedback:${initialPayload.token || "dev"}`}
                            allowImages={false}
                        />
                    )}
                    <Settings
                        taterMode={false}
                        onTaterModeChange={() => {}}
                        origin="runwield"
                        mode="plan"
                        allowedTabs={["display", "labels", "shortcuts", "general"]}
                        showIntegrations={false}
                        externalOpen={settingsOpen}
                        onExternalClose={() => setSettingsOpen(false)}
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

function PlanReviewOptionsMenu({ onOpenSettings, onPrint }) {
    const { theme, setTheme } = useTheme();
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
                    <div className="px-3 py-2 space-y-1.5">
                        <ActionMenuSectionLabel>Theme</ActionMenuSectionLabel>
                        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
                            {["light", "dark", "system"].map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => {
                                        closeMenu();
                                        setTheme(mode);
                                    }}
                                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                        theme === mode
                                            ? "bg-background text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {mode === "light" ? <SunIcon /> : mode === "dark" ? <MoonIcon /> : <SystemIcon />}
                                    <span className="capitalize">{mode}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <ActionMenuDivider />
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

function readEmbeddedPayload(name) {
    const node = document.querySelector(`script[data-${name}]`);
    if (!node?.textContent) return null;
    try {
        return JSON.parse(node.textContent);
    } catch {
        return null;
    }
}
