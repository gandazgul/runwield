// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertStringIncludes } from "@std/assert";

const ROUTE_PATH = "src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro";
const SURFACE_PATH = "src/ui/workspace/react/PlanReviewSurface.tsx";
const CODE_SURFACE_PATH = "src/ui/workspace/react/CodeReviewSurface.tsx";
const REMOTE_SURFACE_PATH = "src/ui/workspace/react/RemotePlanReview.tsx";
const ANNOTATION_TOOLSTRIP_PATH = "src/ui/workspace/react/RunWieldAnnotationToolstrip.tsx";
const SETTINGS_PATH = "src/ui/workspace/react/PlanReviewSettings.tsx";

Deno.test("Phone Plan review keeps full editing annotations and actions reachable", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "Edit");
    assertStringIncludes(surface, "Annotations");
    assertStringIncludes(surface, "Feedback");
});

Deno.test("Approve and Run opens stable Plan progress without changing other review outcomes", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(route, "interactionAnswerUrl");
    assertStringIncludes(route, "progressUrl");
    assertStringIncludes(surface, "Approve & Run");
    assertStringIncludes(surface, "PLAN_APPROVAL_ACTIONS.RUN");
    assertStringIncludes(surface, "globalThis.location.assign(initialPayload.progressUrl)");
    assertStringIncludes(surface, "Later");
    assertStringIncludes(surface, "approved-later");
});

Deno.test("Plan review exposes Workspace recovery when live Plan evidence requires it", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(route, "recoveryUrl");
    assertStringIncludes(route, "force-recovery");
    assertStringIncludes(surface, "recovery_required");
    assertStringIncludes(surface, "Recover in Workspace");
    assertStringIncludes(surface, "runRecoveryAction");
});

Deno.test("Plan feedback action sits above the annotation list with theme accent styling", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);
    const styles = await Deno.readTextFile("src/ui/workspace/react/plannotator.css");
    const sidebarIndex = surface.indexOf('className="rw-plan-review-annotation-sidebar"');
    const actionIndex = surface.indexOf('label="Send Annotations"');
    const panelIndex = surface.indexOf('presentation="embedded"');

    const components = await Deno.readTextFile("src/ui/design-system/components.css");

    assertStringIncludes(surface, 'className="rw-review-feedback-action rw-review-action"');
    assertStringIncludes(styles, ".rw-review-feedback-action");
    assertStringIncludes(components, ".rw-review-action-button");
    assertStringIncludes(components, "var(--rw-accent)");
    if (sidebarIndex < 0 || actionIndex < sidebarIndex || panelIndex < actionIndex) {
        throw new Error("Send Annotations must sit above the right-side annotation list");
    }
});

Deno.test("Code feedback action matches the Plan annotation sidebar treatment", async () => {
    const surface = await Deno.readTextFile(CODE_SURFACE_PATH);
    const sidebarIndex = surface.indexOf('className="rw-code-review-annotation-sidebar"');
    const actionIndex = surface.indexOf('label="Send Annotations"');
    const listIndex = surface.indexOf("<ReviewSidebar", sidebarIndex);

    assertStringIncludes(surface, 'className="rw-review-feedback-action rw-review-action"');
    assertStringIncludes(surface, 'label="Send Annotations"');
    if (sidebarIndex < 0 || actionIndex < sidebarIndex || listIndex < actionIndex) {
        throw new Error("Code Review's Send Annotations action must sit above the annotation list");
    }
});

Deno.test("Code Review options menu matches Plan Review header placement", async () => {
    const surface = await Deno.readTextFile(CODE_SURFACE_PATH);
    const headingIndex = surface.indexOf('className="rw-plan-review-heading"');
    const optionsIndex = surface.indexOf("<CodeReviewOptionsMenu", headingIndex);
    const logoIndex = surface.indexOf('<img src="/brand/logo.svg"', headingIndex);
    const actionsIndex = surface.indexOf('className="rw-plannotator-actions"');
    const approveIndex = surface.indexOf("<ApproveButton", actionsIndex);
    const misplacedOptionsIndex = surface.indexOf("<CodeReviewOptionsMenu", actionsIndex);

    assertStringIncludes(surface, "function CodeReviewOptionsMenu({\n    iconOnly = false,");
    assertStringIncludes(surface, "!iconOnly && <span");
    if (headingIndex < 0 || optionsIndex < headingIndex || logoIndex < optionsIndex) {
        throw new Error("Code Review options must be icon-only before the logo, matching Plan Review");
    }
    if (actionsIndex < 0 || approveIndex < actionsIndex || misplacedOptionsIndex >= 0) {
        throw new Error("Code Review top-right actions must not contain the options menu");
    }
});

Deno.test("Code Review uses the Plan Review card surface for review panels", async () => {
    const styles = await Deno.readTextFile("src/ui/workspace/react/plannotator.css");

    assertStringIncludes(styles, ".rw-review-file-tree {");
    assertStringIncludes(styles, ".rw-code-review-annotation-sidebar {");
    assertStringIncludes(styles, ".rw-code-review-annotation-sidebar > aside {");
    assertStringIncludes(styles, ".rw-review-all-files-host {");
    assertStringIncludes(styles, ".rw-code-diff-stage {");
    assertStringIncludes(styles, ".rw-code-review diffs-container {");
    assertStringIncludes(styles, "background: var(--card);");
    assertStringIncludes(styles, "background: var(--card) !important;");
});

Deno.test("Plan and Code review use shared toolbar structure with edge-aligned restore buttons", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);
    const codeSurface = await Deno.readTextFile(CODE_SURFACE_PATH);
    const styles = await Deno.readTextFile("src/ui/workspace/react/plannotator.css");
    const leftRestoreIndex = surface.indexOf(
        'className="rw-review-toolbar-edge rw-review-toolbar-edge-left rw-plan-review-sidebar-restore rw-plan-review-sidebar-restore-left"',
    );
    const contentsIndex = surface.indexOf("Contents", leftRestoreIndex);
    const modeActionsIndex = surface.indexOf('className="rw-review-toolbar-center rw-plan-review-mode-actions"');
    const rightRestoreIndex = surface.indexOf(
        'className="rw-review-toolbar-edge rw-review-toolbar-edge-right rw-plan-review-sidebar-restore rw-plan-review-sidebar-restore-right"',
    );
    const annotationsIndex = surface.indexOf("Annotations", rightRestoreIndex);
    const saveControlsIndex = surface.indexOf('className="rw-editor-save-controls"', rightRestoreIndex);
    const sidebarIndex = surface.indexOf('className="rw-plan-review-annotation-sidebar"');
    const collapseIndex = surface.indexOf('<PanelCollapseIcon side="right" />', sidebarIndex);

    assertStringIncludes(surface, "data-plan-width={planWidthMode}");
    assertStringIncludes(surface, 'className="rw-review-toolbar rw-plan-review-controls"');
    assertStringIncludes(surface, 'className="rw-plan-sidebar-tab-toggle rw-segmented-toggle"');
    assertStringIncludes(surface, 'aria-label="Plan sidebar"');
    assertStringIncludes(surface, '<ToggleIcon name="contents" />');
    assertStringIncludes(surface, '<ToggleIcon name="versions" />');
    assertStringIncludes(surface, '<ToggleIcon name="view" />');
    assertStringIncludes(surface, '<ToggleIcon name="edit" />');
    assertStringIncludes(surface, '<ToggleIcon name="changes" />');
    assertStringIncludes(surface, '<ToggleIcon name="annotations" />');
    assertStringIncludes(surface, '<h2 id="rw-plan-review-annotations-heading">Annotations</h2>');
    assertStringIncludes(surface, "<span>Contents</span>");
    assertStringIncludes(surface, "<span>Annotations</span>");
    assertStringIncludes(surface, 'className="rw-toolbar-button"');
    assertStringIncludes(surface, "disabled={!editorDirty}");
    if (styles.includes(".rw-editor-save-controls button")) {
        throw new Error("Plan Review Save button must use shared rw-toolbar-button CSS");
    }
    assertStringIncludes(surface, '{ value: "engineer", label: "Engineer", icon: "engineer" }');
    assertStringIncludes(surface, '{ value: "frontend-engineer", label: "Frontend Engineer", icon: "frontend" }');
    assertStringIncludes(surface, '{ value: "pair", label: "Pair Execution", icon: "pair" }');
    assertStringIncludes(surface, '{ value: "autonomous", label: "Autonomous", icon: "autonomous" }');
    assertStringIncludes(styles, ".rw-plan-review .rw-plannotator-plan-layout:has(> .rw-plan-sidebar-tab-toggle)");
    assertStringIncludes(styles, "top: calc((var(--rw-review-toolbar-h, 4rem) - 2.25rem) / 2);");
    assertStringIncludes(surface, "compact\n                                                    showHelpLink={false}");
    assertStringIncludes(codeSurface, 'className="rw-review-toolbar rw-code-diff-toolbar"');
    assertStringIncludes(codeSurface, "<FileTreeIcon />");
    assertStringIncludes(codeSurface, "<CommentIcon />");
    assertStringIncludes(codeSurface, "<h2>Annotations</h2>");
    assertStringIncludes(codeSurface, 'return readStoredFilePanelMode() || "tree";');
    const filesToggleIndex = codeSurface.indexOf('title="Files"');
    const changesToggleIndex = codeSurface.indexOf('title="Changes"');
    if (filesToggleIndex === -1 || changesToggleIndex === -1 || filesToggleIndex > changesToggleIndex) {
        throw new Error("Code Review file panel toggle must show Files before Changes");
    }
    assertStringIncludes(codeSurface, "<span>Files</span>");
    assertStringIncludes(codeSurface, "<span>Annotations</span>");
    assertStringIncludes(
        codeSurface,
        'className="rw-review-toolbar-edge rw-review-toolbar-edge-left rw-code-diff-left-controls"',
    );
    assertStringIncludes(
        codeSurface,
        'className="rw-review-toolbar-edge rw-review-toolbar-edge-right rw-code-diff-layout-controls"',
    );
    assertStringIncludes(surface, "data-annotations-open={annotationsOpen}");
    assertStringIncludes(surface, 'className="rw-plan-review-sidebar-collapse"');
    assertStringIncludes(surface, 'title="Collapse contents sidebar"');
    assertStringIncludes(surface, 'aria-label="Collapse contents sidebar"');
    assertStringIncludes(surface, '<PanelCollapseIcon side="left" />');
    assertStringIncludes(surface, 'title="Collapse annotations sidebar"');
    assertStringIncludes(surface, 'aria-label="Collapse annotations sidebar"');
    assertStringIncludes(surface, "z-[90]");
    assertStringIncludes(surface, 'planWidthMode === "wide"');
    assertStringIncludes(surface, "function PanelCollapseIcon({ side })");
    assertStringIncludes(styles, ".fixed.inset-0.z-50.bg-black\\/50.backdrop-blur-\\[2px\\]");
    assertStringIncludes(styles, '[data-popout="true"] {');
    assertStringIncludes(styles, "z-index: 1100 !important;");
    assertStringIncludes(styles, '[data-popout="true"] diffs-container');
    assertStringIncludes(styles, ".rw-review-toolbar {");
    assertStringIncludes(styles, "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);");
    assertStringIncludes(styles, "min-height: var(--rw-review-toolbar-h, 4rem);");
    assertStringIncludes(styles, "padding: var(--rw-review-toolbar-padding, 0.75rem);");
    assertStringIncludes(styles, ".rw-review-toolbar-edge-left");
    assertStringIncludes(styles, "grid-column: 1;");
    assertStringIncludes(styles, ".rw-review-toolbar-edge-right");
    assertStringIncludes(styles, "grid-column: 3;");
    assertStringIncludes(styles, ".rw-review-toolbar-center");
    assertStringIncludes(styles, "grid-column: 2;");
    assertStringIncludes(styles, ".rw-code-file-tabs {");
    assertStringIncludes(
        styles,
        ".rw-plan-review .rw-plannotator-plan-layout > aside:not([data-annotation-panel]) > div:first-child {",
    );
    assertStringIncludes(styles, "background: color-mix(in oklab, var(--plannotator-surface) 92%, transparent);");
    assertStringIncludes(styles, ".rw-plan-review-annotation-heading,");
    assertStringIncludes(styles, ".rw-review-annotation-heading {");
    assertStringIncludes(styles, "grid-template-columns: 17.5rem minmax(0, 1fr) 20rem;");
    assertStringIncludes(styles, "grid-template-columns: 17.5rem minmax(0, 1fr);");
    assertStringIncludes(styles, '.rw-plannotator-plan-layout[data-annotations-open="false"]');
    assertStringIncludes(
        styles,
        '.rw-plannotator-plan-layout[data-sidebar-open="false"][data-annotations-open="false"]',
    );
    assertStringIncludes(styles, ".rw-plan-review-controls {");
    assertStringIncludes(styles, "grid-template-columns: auto minmax(0, 1fr) auto;");
    assertStringIncludes(styles, ".rw-plan-review-mode-actions {");
    assertStringIncludes(styles, '.rw-plan-review[data-plan-width="wide"] .rw-plan-document-canvas');
    assertStringIncludes(styles, '.rw-plan-review[data-plan-width="wide"] article[data-print-region="article"]');
    assertStringIncludes(styles, "max-width: none !important;");
    assertStringIncludes(styles, "border: 0 !important;");
    assertStringIncludes(styles, "border-radius: 0 !important;");
    assertStringIncludes(styles, "box-shadow: none !important;");
    assertStringIncludes(styles, "justify-content: flex-start;");
    assertStringIncludes(styles, "justify-self: start;");
    assertStringIncludes(styles, ".rw-plan-review-sidebar-collapse");
    if (
        styles.includes("--rw-review-toolbar-h: var(--panel-header-h, 2.5rem)") ||
        styles.includes("--rw-review-toolbar-padding: 0.35rem 0.75rem")
    ) {
        throw new Error("Code Review must not opt out of the shared review toolbar height and padding");
    }
    if (
        surface.includes("rw-annotation-reopen") || surface.includes("<SidebarTabs") ||
        surface.includes("<ResizeHandle")
    ) {
        throw new Error("Plan Review must use one Code Review-style collapse and toolbar restore pattern");
    }
    if (
        leftRestoreIndex < 0 || contentsIndex < leftRestoreIndex || modeActionsIndex < contentsIndex ||
        rightRestoreIndex < modeActionsIndex || saveControlsIndex < rightRestoreIndex ||
        annotationsIndex < rightRestoreIndex || sidebarIndex < 0 || collapseIndex < sidebarIndex
    ) {
        throw new Error(
            "Plan Review must align Contents left, edit Save controls right, and Annotations right in the toolbar",
        );
    }
});

Deno.test("Review segmented toggles use shared compact icon-label behavior", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);
    const remoteSurface = await Deno.readTextFile(REMOTE_SURFACE_PATH);
    const settings = await Deno.readTextFile(SETTINGS_PATH);
    const wrapper = await Deno.readTextFile(ANNOTATION_TOOLSTRIP_PATH);
    const styles = await Deno.readTextFile("src/ui/workspace/react/plannotator.css");
    const components = await Deno.readTextFile("src/ui/design-system/components.css");
    const docs = await Deno.readTextFile("docs/design-system.md");

    assertStringIncludes(surface, "<RunWieldAnnotationToolstrip");
    assertStringIncludes(remoteSurface, "<RunWieldAnnotationToolstrip");
    assertStringIncludes(wrapper, 'classList.add("rw-segmented-toggle")');
    assertStringIncludes(wrapper, "button.title = label;");
    assertStringIncludes(wrapper, 'button.setAttribute("aria-label", label);');
    assertStringIncludes(wrapper, 'className="rw-plannotator-annotation-toolstrip"');
    if (styles.includes(".rw-plannotator-annotation-toolstrip .rw-segmented-toggle button")) {
        throw new Error("Workspace CSS must not customize segmented-toggle buttons");
    }
    assertStringIncludes(components, ".rw-segmented-toggle button > div");
    assertStringIncludes(components, ".rw-segmented-toggle button span:not([aria-hidden])");
    assertStringIncludes(components, ".rw-segmented-toggle button:hover:not(:disabled)");
    assertStringIncludes(docs, "Inactive options stay icon-only.");
    assertStringIncludes(docs, "hover must not expand labels");
    assertStringIncludes(settings, "<SettingsToggleIcon name={option.id} />");
    assertStringIncludes(settings, "<SettingsToggleIcon name={option.value} />");
    assertStringIncludes(settings, "title={option.label}");
});

Deno.test("Feedback and Run return to Session while Later stays on confirmation", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(route, "interactionAnswerUrl");
    assertStringIncludes(surface, "Approve & Run");
    assertStringIncludes(surface, "Later");
    assertStringIncludes(surface, "approved-later");
});

Deno.test("Plan and Epic reviews expose classification-correct actions", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "PLAN_APPROVAL_ACTIONS.DECOMPOSE");
    assertStringIncludes(surface, "Approve & Slice");
    assertStringIncludes(surface, "Approve & Run");
});

Deno.test("revised Plan reviews expose selectable Plannotator version history", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "usePlanDiff");
    assertStringIncludes(surface, "PlanDiffViewer");
    assertStringIncludes(surface, "normalizePlanReviewVersions");
    assertStringIncludes(surface, "showVersionsTab={versionInfo !== null}");
    assertStringIncludes(surface, "onSelectBaseVersion={selectPlanVersion}");
    assertStringIncludes(surface, "Changes");
});

Deno.test("Plan reviews inspect affected files and export complete feedback", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "AffectedFilesMenu");
    assertStringIncludes(surface, "onOpenCodeFile={codeFilePopout.open}");
    assertStringIncludes(surface, "CodeFilePopout");
    assertStringIncludes(surface, "codeAnnotations={codeAnnotations}");
    assertStringIncludes(surface, "Export review feedback");
    assertStringIncludes(surface, 'annotationsOutput={exportOpen ? currentFeedback() : ""}');
});

Deno.test("Plan reviews recover unfinished work and send direct edits as feedback", async () => {
    const surface = await Deno.readTextFile(SURFACE_PATH);

    assertStringIncludes(surface, "Unfinished review found");
    assertStringIncludes(surface, "Restore draft");
    assertStringIncludes(surface, "persistReviewDraftLocally");
    assertStringIncludes(surface, "directEdits={directEditPanel}");
    assertStringIncludes(surface, "disabled={!hasReviewFeedback || submitting !== null}");
    assertStringIncludes(surface, "buildPlanReviewFeedback");
});
