/**
 * Shared review surface typedefs.
 *
 * This file intentionally contains JSDoc-only types so Workspace review
 * surfaces can share shapes without introducing executable TypeScript syntax.
 */

/**
 * @typedef {Object} PlanReviewOptions
 * @property {string} plan
 * @property {string} token
 * @property {string} [planPath]
 * @property {"workflow" | "dev"} mode
 * @property {Record<string, unknown>} [frontmatter]
 * @property {string} [imageBaseDir]
 */

/**
 * @typedef {Object} CodeReviewOptions
 * @property {string} rawPatch
 * @property {string} gitRef
 * @property {string} agentCwd
 * @property {string} token
 * @property {{ stagedFiles: string[], unstagedFiles: string[], untrackedFiles: string[] }} [reviewStatus]
 * @property {"workflow" | "dev"} mode
 */

/**
 * @typedef {Object} PlanReviewDecision
 * @property {boolean} approved
 * @property {string} [feedback]
 * @property {unknown[]} [annotations]
 * @property {string} [plan]
 * @property {string} [savedPath]
 * @property {boolean} [exit]
 * @property {string} [agentSwitch]
 * @property {string} [permissionMode]
 */

/**
 * @typedef {Object} CodeReviewAnnotation
 * @property {string} id
 * @property {string} filePath
 * @property {number} line
 * @property {string} side
 * @property {string} comment
 */

/**
 * @typedef {Object} CodeReviewDecision
 * @property {boolean} approved
 * @property {string} feedback
 * @property {CodeReviewAnnotation[]} annotations
 * @property {Array<{path: string, name: string}>} [images]
 * @property {boolean} [exit]
 * @property {boolean} [canceled]
 * @property {string} [agentSwitch]
 */

/**
 * @typedef {Object} ReviewSurfaceResult
 * @property {string} url
 * @property {() => Promise<any>} waitForDecision
 * @property {() => void | Promise<void>} stop
 */

export {};
