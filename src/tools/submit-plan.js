/**
 * @module submit-plan
 * Harns function that submits a plan to the Plannotator review UI.
 *
 * Now uses the compiled @gandazgul/plannotator-pi-extension-compiled package
 * to call the server in-process, eliminating the need for the plannotator CLI.
 */

import {
  injectFrontMatter,
  parsePlanFrontMatter,
  updatePlanStatus,
} from "../plan-store.js";
import { startPlanReviewServer } from "@gandazgul/plannotator-pi-extension-compiled/server";
import { plannotatorHtml } from "@gandazgul/plannotator-pi-extension-compiled/assets";

// ─── Browser Helpers ───────────────────────────────────────────────────

/**
 * Open a URL in the system default browser.
 * Non-fatal: returns false if opening fails.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function openInDefaultBrowser(url) {
  /** @type {{ command: string; args: string[] }} */
  let launcher;

  switch (Deno.build.os) {
    case "darwin":
      launcher = { command: "open", args: [url] };
      break;
    case "windows":
      launcher = { command: "cmd", args: ["/c", "start", "", url] };
      break;
    default:
      launcher = { command: "xdg-open", args: [url] };
      break;
  }

  try {
    const proc = new Deno.Command(launcher.command, {
      args: launcher.args,
      stdout: "null",
      stderr: "null",
    }).spawn();

    // We don't fail the flow if browser opening fails.
    await proc.status.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// ─── Types ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanReviewResult
 * @property {boolean} approved - Whether the plan was approved
 * @property {string} [feedback] - User feedback/annotations (present on denial or approve-with-notes)
 * @property {string} [savedPath] - Optional path where plan was saved (if available)
 */

// ─── Main Function ────────────────────────────────────────────────────

/**
 * Submit a plan for interactive review via the Plannotator browser UI.
 *
 * @param {Object} opts
 * @param {string} opts.cwd - Project root
 * @param {string} opts.planName - Plan filename (without .md)
 * @param {string} opts.planPath - Absolute path to the plan .md file
 * @param {Partial<import('../plan-store.js').PlanFrontMatter>} [opts.triageMeta] - Triage metadata to ensure in front matter
 * @returns {Promise<PlanReviewResult>}
 */
export async function submitPlanForReview({
  cwd,
  planName,
  planPath,
  triageMeta,
}) {
  // 1. Read plan
  const planContent = await Deno.readTextFile(planPath);

  // 2. Ensure front matter is present and up to date
  const { attrs, body } = parsePlanFrontMatter(planContent);
  const fmOverrides = {
    ...attrs,
    status: "in_review",
    updatedAt: new Date().toISOString(),
  };

  if (triageMeta) {
    if (triageMeta.classification) {
      fmOverrides.classification = triageMeta.classification;
    }
    if (triageMeta.complexity) fmOverrides.complexity = triageMeta.complexity;
    if (triageMeta.summary) fmOverrides.summary = triageMeta.summary;
    if (triageMeta.affectedPaths) {
      fmOverrides.affectedPaths = triageMeta.affectedPaths;
    }
  }

  const planWithFm = injectFrontMatter(body, fmOverrides);
  await Deno.writeTextFile(planPath, planWithFm);

  // 3. Use HTML embedded in package exports (compile-safe; no runtime fs lookup).
  const htmlContent = plannotatorHtml;

  console.log(`\n[Harns] Opening plan review UI for: ${planName}`);
  console.log(`[Harns] Plan file: ${planPath}`);

  // 4. Start review server IN-PROCESS
  const server = await startPlanReviewServer({
    plan: planWithFm,
    htmlContent,
    origin: "harns",
  });

  console.log(`[Harns] Review UI available at: ${server.url}`);

  const opened = await openInDefaultBrowser(server.url);
  if (opened) {
    console.log(`[Harns] Opened review UI in your default browser.`);
  } else {
    console.log(
      `[Harns] Could not auto-open browser. Open manually: ${server.url}`,
    );
  }

  console.log(`[Harns] Waiting for user decision...`);

  try {
    // 5. Wait for user decide (blocks until approve/deny)
    const decision = await server.waitForDecision();

    // 6. Update status
    if (decision.approved) {
      await updatePlanStatus(cwd, planName, "approved");
      console.log(`\n[Harns] ✅ Plan approved: ${planName}`);
    } else {
      await updatePlanStatus(cwd, planName, "denied");
      console.log(`\n[Harns] ❌ Plan denied: ${planName}`);
    }

    return {
      approved: decision.approved,
      feedback: decision.feedback,
    };
  } finally {
    // Ensure server is stopped regardless of outcome
    server.stop();
  }
}
