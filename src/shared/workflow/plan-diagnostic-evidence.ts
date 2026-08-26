/** Read-only identity evidence for repairing a registry that cannot route normal reads. */
import { join } from "@std/path";
import { getPlansDir, parsePlanFrontMatter, type PlanFrontMatter } from "../../plan-store.js";
import { isEpicArtifactPlanName } from "../epic-artifacts.ts";

interface DiagnosticAttempt {
    id: string;
    planId?: string;
    planName: string;
    path: string;
    status: string;
}

interface PlanIdentityDocument {
    name: string;
    path: string;
    attrs: PlanFrontMatter;
}

async function readDocuments(root: string, prefix: string[] = []): Promise<PlanIdentityDocument[]> {
    const documents: PlanIdentityDocument[] = [];
    const directory = join(getPlansDir(root), ...prefix);
    try {
        for await (const entry of Deno.readDir(directory)) {
            if (entry.isDirectory && !entry.name.endsWith(".md")) {
                if (prefix.length === 0 && entry.name === "archived") continue;
                documents.push(...await readDocuments(root, [...prefix, entry.name]));
            } else if (entry.isFile && entry.name.endsWith(".md")) {
                const name = [...prefix, entry.name.slice(0, -3)].join("/");
                if (isEpicArtifactPlanName(name)) continue;
                const path = join(directory, entry.name);
                try {
                    const { attrs } = parsePlanFrontMatter(await Deno.readTextFile(path));
                    documents.push({ name, path, attrs });
                } catch {
                    // Malformed documents are reported by doctor, never identity proof.
                }
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return documents;
}

/**
 * These are raw documents, not an editable catalogue or joined controller view.
 * Known attempts can only obtain identity evidence from their execution directory.
 * Legacy rows without a stable ID may still use explicit on-disk recovery hints.
 */
export async function inspectPlanIdentityDocuments(projectRoot: string, attempts: DiagnosticAttempt[]) {
    const primary = await readDocuments(projectRoot);
    const primaryPaths = new Set(primary.map((plan) => plan.path));
    const live = attempts.filter((attempt) => attempt.status !== "abandoned");
    const documents = primary.filter((plan) =>
        !live.some((attempt) => attempt.planId && attempt.planId === plan.attrs.planId)
    );
    for (const attempt of live) {
        for (const plan of await readDocuments(attempt.path)) {
            const matches = attempt.planId
                ? plan.attrs.planId === attempt.planId
                : plan.attrs.worktreeId === attempt.id || plan.name === attempt.planName;
            if (!matches) continue;
            const duplicate = documents.findIndex((candidate) =>
                primaryPaths.has(candidate.path) &&
                candidate.name === plan.name && candidate.attrs.planId === plan.attrs.planId
            );
            if (duplicate >= 0) documents.splice(duplicate, 1);
            documents.push(plan);
        }
    }
    return documents;
}
