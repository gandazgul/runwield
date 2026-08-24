import { publishExecutionWorktreeIsolated } from "../../isolated-publication.ts";
import {
    advanceStoredPublication,
    cleanupStoredPublication,
    loadPublicationAttempt,
    reconcileStoredPublication,
} from "../publication-machine.ts";

type DriverConfig = {
    projectRoot: string;
    attemptId: string;
    crashAfter?: string;
};

function crash(config: DriverConfig, boundary: string): void {
    if (config.crashAfter === boundary) Deno.exit(86);
}

const configPath = Deno.args[0];
if (!configPath) throw new Error("publication process driver requires a config path");
const config = JSON.parse(await Deno.readTextFile(configPath)) as DriverConfig;
let attempt = await loadPublicationAttempt(config.projectRoot, config.attemptId);
if (!attempt) Deno.exit(0);
attempt = await reconcileStoredPublication(config.projectRoot, attempt);

if (attempt.phase !== "publication_verified" && attempt.phase !== "cleanup_complete") {
    const artifactCommit = attempt.artifactCommit;
    if (!artifactCommit) throw new Error("publication process driver requires committed artifacts");
    await publishExecutionWorktreeIsolated({
        projectRoot: config.projectRoot,
        executionCwd: attempt.executionCwd,
        executionBranch: attempt.executionBranch,
        targetBranch: attempt.targetBranch,
        planName: attempt.planName,
        sealedExecutionCommit: artifactCommit,
        allowedPlanPaths: attempt.planPaths || [],
        publicationRoot: attempt.publicationRoot,
        onIntegrated: async (evidence) => {
            crash(config, "integrated_effect");
            attempt = await advanceStoredPublication(config.projectRoot, attempt!, "target_integrated", evidence);
            crash(config, "integrated_record");
        },
        onPublished: async (evidence) => {
            crash(config, "published_effect");
            attempt = await advanceStoredPublication(config.projectRoot, attempt!, "target_published", evidence);
            crash(config, "published_record");
        },
        onVerified: async () => {
            attempt = await advanceStoredPublication(config.projectRoot, attempt!, "publication_verified", {
                verifiedAt: new Date().toISOString(),
            });
            crash(config, "verified_record");
        },
    });
}

attempt = await loadPublicationAttempt(config.projectRoot, config.attemptId);
if (!attempt) Deno.exit(0);
attempt = await reconcileStoredPublication(config.projectRoot, attempt);
if (attempt.phase === "publication_verified") {
    if (config.crashAfter === "cleanup_effect") {
        await new Deno.Command("git", {
            cwd: config.projectRoot,
            args: ["worktree", "remove", "--force", attempt.executionCwd],
            stdout: "null",
            stderr: "null",
        }).output();
        await new Deno.Command("git", {
            cwd: config.projectRoot,
            args: ["branch", "-D", attempt.executionBranch],
            stdout: "null",
            stderr: "null",
        }).output();
        await Deno.remove(attempt.publicationRoot, { recursive: true }).catch(() => {});
        Deno.exit(86);
    }
    const cleanup = await cleanupStoredPublication(config.projectRoot, attempt);
    if (!cleanup.complete) throw new Error(`publication cleanup incomplete: ${cleanup.details.join("; ")}`);
    attempt = cleanup.attempt;
}
if (attempt.phase === "cleanup_complete") await cleanupStoredPublication(config.projectRoot, attempt);
