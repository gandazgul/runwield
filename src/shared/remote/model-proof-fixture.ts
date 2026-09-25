import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    createAssistantMessageEventStream,
    createProvider,
    fauxAssistantMessage,
    fauxText,
    fauxToolCall,
    InMemoryCredentialStore,
    type ProviderStreams,
} from "@earendil-works/pi-ai";
import { parseRemoteModelProof } from "./model-proof-config.ts";
import { runRemoteModelProof } from "./model-proof.ts";
import { handleModelRequest, LocalModelBridge } from "./model-bridge.ts";

export async function exerciseProof(validReply: boolean): Promise<void> {
    const root = await Deno.makeTempDir();
    const project = join(root, "project");
    const outside = join(root, "outside");
    await Deno.mkdir(project);
    await Deno.mkdir(outside);
    await Deno.writeTextFile(join(outside, "settings.json"), "{}");
    const sentinel = `remote-${crypto.randomUUID()}`;
    await Deno.writeTextFile(join(project, "sentinel.txt"), sentinel);
    await Deno.writeTextFile(join(outside, "secret.txt"), "laptop-private");
    await Deno.symlink(join(outside, "secret.txt"), join(project, "linked.txt"));
    const contexts: string[] = [];
    const stream: ProviderStreams["streamSimple"] = (_model, context) => {
        const result = createAssistantMessageEventStream();
        contexts.push(JSON.stringify(context));
        queueMicrotask(() => {
            result.push({
                type: "done",
                reason: "stop",
                message: contexts.length === 1
                    ? fauxAssistantMessage(fauxToolCall("read_remote_sentinel", {}))
                    : fauxAssistantMessage(fauxText(validReply ? `Confirmed ${sentinel}` : "Unrelated response")),
            });
            result.end();
        });
        return result;
    };
    const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    runtime.registerNativeProvider(createProvider({
        id: "proof-local",
        name: "Proof",
        models: [{
            provider: "proof-local",
            id: "test",
            name: "Test",
            api: "openai-completions",
            baseUrl: "https://private-laptop.invalid",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1000,
            maxTokens: 100,
        }],
        auth: {
            apiKey: {
                name: "Local",
                check: () => Promise.resolve({ type: "api_key" }),
                resolve: () => Promise.resolve({ auth: {} }),
            },
        },
        api: { stream, streamSimple: stream },
    }));
    await runtime.refresh({ allowNetwork: false });
    const bridge = new LocalModelBridge(runtime);
    const credential = "a".repeat(64);
    const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        (request) =>
            request.headers.get("Authorization") === `Bearer ${credential}`
                ? handleModelRequest(bridge, request, new URL(request.url).pathname)
                : new Response(null, { status: 401 }),
    );
    const mount = { globalRoot: outside, lost: new Promise<void>(() => {}), close: () => Promise.resolve() };
    const connection = { port: server.addr.transport === "tcp" ? server.addr.port : 0, credential };
    try {
        await assertRejects(
            () =>
                runRemoteModelProof({
                    proof: { provider: "proof-local", modelId: "test", sentinelFile: "linked.txt" },
                    mount,
                    connection,
                    cwd: project,
                }),
            Error,
            "inside the remote project",
        );
        assertEquals(contexts.length, 0);
        const run = () =>
            runRemoteModelProof({
                proof: parseRemoteModelProof(
                    '{"provider":"proof-local","modelId":"test","sentinelFile":"sentinel.txt"}',
                ),
                mount,
                connection,
                cwd: project,
            });
        if (validReply) await run();
        else await assertRejects(run, Error, "did not confirm the remote tool result and response");
        assertEquals(contexts.length, 2);
        assertStringIncludes(contexts[1], sentinel);
        assertEquals(contexts.join(" ").includes("laptop-private"), false);
    } finally {
        bridge.close();
        await server.shutdown();
        await Deno.remove(root, { recursive: true });
    }
}
