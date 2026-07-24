export type PlanExecutionAgent = "engineer" | "frontend-engineer";
export type PlanCollaborationRecommendation = "autonomous" | "pair";

export type PlanReviewOptions = {
    plan: string;
    token: string;
    planPath?: string;
    mode: "workflow" | "dev";
    classification?: "QUICK_FIX" | "FEATURE" | "PROJECT";
    frontmatter?: Record<string, unknown>;
    executionPolicy?: {
        executionAgent: PlanExecutionAgent;
        collaborationRecommendation: PlanCollaborationRecommendation;
        source?: string;
    };
    imageBaseDir?: string;
};

export type ArtifactReadOptions = {
    surface: "artifact-read";
    markdown: string;
    token: string;
    artifactKind: "plan" | "work-record";
    title: string;
    artifactPath?: string;
    notices?: string[];
    mode: "workflow" | "dev";
    imageBaseDir?: string;
};

export type CodeReviewOptions = {
    rawPatch: string;
    gitRef: string;
    agentCwd: string;
    token: string;
    reviewStatus?: {
        stagedFiles: string[];
        unstagedFiles: string[];
        untrackedFiles: string[];
    };
    mode: "workflow" | "dev";
};

export type PlanReviewDecision = {
    approved: boolean;
    feedback?: string;
    annotations?: unknown[];
    plan?: string;
    savedPath?: string;
    approvalAction?: "run" | "decompose" | "later";
    executionAgent?: PlanExecutionAgent;
    collaborationRecommendation?: PlanCollaborationRecommendation;
    planAttrs?: Record<string, unknown>;
    exit?: boolean;
    agentSwitch?: string;
    permissionMode?: string;
};

export type CodeReviewAnnotation = {
    id: string;
    filePath: string;
    line: number;
    side: string;
    comment: string;
};

export type CodeReviewDecision = {
    approved: boolean;
    feedback: string;
    annotations: CodeReviewAnnotation[];
    images?: Array<{ path: string; name: string }>;
    exit?: boolean;
    canceled?: boolean;
    agentSwitch?: string;
};

export type ReviewSurfaceResult = {
    url: string;
    waitForDecision: () => Promise<unknown>;
    stop: () => void | Promise<void>;
};
