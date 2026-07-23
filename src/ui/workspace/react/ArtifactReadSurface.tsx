// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useMemo, useState } from "react";
import { ThemeProvider } from "@plannotator/ui/components/ThemeProvider.tsx";
import { TooltipProvider } from "@plannotator/ui/components/Tooltip.tsx";
import { Viewer } from "@plannotator/ui/components/Viewer.tsx";
import { OverlayScrollArea } from "@plannotator/ui/components/OverlayScrollArea.tsx";
import { SidebarContainer } from "@plannotator/ui/components/sidebar/SidebarContainer.tsx";
import { ScrollViewportContext } from "@plannotator/ui/hooks/useScrollViewport.ts";
import { usePrintMode } from "@plannotator/ui/hooks/usePrintMode.ts";
import { useConfigValue } from "@plannotator/ui/config/index.ts";
import { extractFrontmatter, parseMarkdownToBlocks } from "@plannotator/ui/utils/parser.ts";
import { getUIPreferences, PLAN_WIDTH_OPTIONS } from "@plannotator/ui/utils/uiPreferences.ts";
import "./plannotator.css";

const DEFAULT_READ_PAYLOAD = {
    markdown: "",
    plan: "",
    token: "",
    mode: "dev",
    artifactKind: "plan",
    title: "Untitled artifact",
    notices: [],
};

export function ArtifactReadSurface({ payload }) {
    usePrintMode();
    const initialPayload = useMemo(() => payload || readEmbeddedPayload("review-payload") || DEFAULT_READ_PAYLOAD, [
        payload,
    ]);
    const markdown = initialPayload.markdown || initialPayload.plan || "";
    const artifactKind = initialPayload.artifactKind === "work-record" ? "work-record" : "plan";
    const artifactLabel = artifactKind === "work-record" ? "Work Record" : "Plan";
    const title = initialPayload.title || `Untitled ${artifactLabel}`;
    const notices = Array.isArray(initialPayload.notices) ? initialPayload.notices.filter(Boolean) : [];
    const [activeSection, setActiveSection] = useState(null);
    const [scrollViewport, setScrollViewport] = useState(null);
    const [closing, setClosing] = useState(false);
    const [closed, setClosed] = useState(false);
    const [closeBlocked, setCloseBlocked] = useState(false);
    const [error, setError] = useState("");
    const uiPreferences = useMemo(() => getUIPreferences(), []);
    const gridEnabled = useConfigValue("gridEnabled");
    const planMaxWidth = useMemo(
        () => PLAN_WIDTH_OPTIONS.find((option) => option.id === uiPreferences.planWidth)?.px || 832,
        [uiPreferences.planWidth],
    );
    const parsed = useMemo(() => {
        const frontmatterResult = extractFrontmatter(markdown);
        return {
            blocks: parseMarkdownToBlocks(markdown),
            frontmatter: frontmatterResult.frontmatter,
        };
    }, [markdown]);

    async function closeReadSurface() {
        if (closing || closed) return;
        setClosing(true);
        setError("");
        try {
            if (initialPayload.mode !== "dev") {
                const response = await fetch(`/api/review/exit?token=${encodeURIComponent(initialPayload.token)}`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-runwield-review-token": initialPayload.token,
                    },
                    body: JSON.stringify({ reviewType: "plan" }),
                });
                if (!response.ok) {
                    const message = await response.text();
                    throw new Error(message || `Close failed: ${response.status}`);
                }
            }
            setClosed(true);
            setClosing(false);
            globalThis.setTimeout(() => {
                globalThis.close?.();
                globalThis.setTimeout(() => {
                    if (!globalThis.closed) setCloseBlocked(true);
                }, 400);
            }, 0);
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            setError(message || "Close failed.");
            setClosing(false);
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
                <div className="rw-plannotator-host rw-plan-review rw-artifact-read" data-artifact-kind={artifactKind}>
                    <header className="rw-plannotator-toolbar">
                        <div className="rw-plan-review-heading rw-artifact-read-heading">
                            <img src="/logo.svg" alt="" aria-hidden="true" />
                            <div className="rw-artifact-read-title-block">
                                <p className="rw-artifact-kicker">Read-only {artifactLabel}</p>
                                <h1>{title}</h1>
                                {initialPayload.artifactPath && (
                                    <p className="rw-artifact-path">{initialPayload.artifactPath}</p>
                                )}
                            </div>
                        </div>
                        <div className="rw-plannotator-actions">
                            <button
                                className="rw-artifact-close-button"
                                type="button"
                                onClick={closeReadSurface}
                                disabled={closing || closed}
                            >
                                {closing ? "Closing…" : closed ? "Closed" : "Close"}
                            </button>
                        </div>
                    </header>
                    {error && <p className="rw-review-error" role="alert">{error}</p>}
                    {closed && closeBlocked && (
                        <div className="rw-artifact-close-notice" role="status">
                            <strong>{artifactLabel} view closed.</strong>
                            <span>
                                The RunWield read session has ended. Your browser blocked automatic tab closure; you can
                                close this tab manually.
                            </span>
                        </div>
                    )}
                    <ScrollViewportContext.Provider value={scrollViewport}>
                        <div className="rw-plannotator-plan-layout rw-artifact-read-layout" data-sidebar-open="true">
                            <SidebarContainer
                                activeTab="toc"
                                onTabChange={() => {}}
                                onClose={() => {}}
                                width={280}
                                blocks={parsed.blocks}
                                annotations={[]}
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
                            <main className="rw-plannotator-main-pane">
                                {notices.length > 0 && (
                                    <section className="rw-artifact-notices" aria-label={`${artifactLabel} notices`}>
                                        {notices.map((notice) => <p key={notice}>{notice}</p>)}
                                    </section>
                                )}
                                <div className="rw-plan-content-area">
                                    <OverlayScrollArea
                                        className="rw-plannotator-scroll-area"
                                        onViewportReady={setScrollViewport}
                                    >
                                        <div className="rw-plan-document-canvas">
                                            <Viewer
                                                blocks={parsed.blocks}
                                                markdown={markdown}
                                                frontmatter={parsed.frontmatter}
                                                annotations={[]}
                                                onAddAnnotation={() => {}}
                                                onSelectAnnotation={() => {}}
                                                selectedAnnotationId={null}
                                                mode="selection"
                                                inputMethod="drag"
                                                taterMode={false}
                                                stickyActions={false}
                                                gridEnabled={gridEnabled}
                                                maxWidth={planMaxWidth}
                                                imageBaseDir={initialPayload.imageBaseDir}
                                                readOnly
                                            />
                                        </div>
                                    </OverlayScrollArea>
                                </div>
                            </main>
                        </div>
                    </ScrollViewportContext.Provider>
                </div>
            </TooltipProvider>
        </ThemeProvider>
    );
}

function readEmbeddedPayload(attribute) {
    const node = document.querySelector(`script[type="application/json"][data-${attribute}]`);
    if (!node?.textContent) return null;
    try {
        return JSON.parse(node.textContent);
    } catch {
        return null;
    }
}
