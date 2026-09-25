import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
    type Context,
    createAssistantMessageEventStream,
    createProvider,
    fauxAssistantMessage,
    fauxText,
    fauxToolCall,
    InMemoryCredentialStore,
    type ProviderStreams,
} from "@earendil-works/pi-ai";
import { createBoundedRemoteModelSession } from "./bounded-model-session.ts";
import { handleModelRequest, LocalModelBridge } from "./model-bridge.ts";
import type { RemoteMount } from "./sftp-mount.ts";

Deno.test("remote Pi retries a laptop EOF after a committed project tool without replaying the tool", async () => {
    // Remote personal resources are process-wide. Keep this test in its own runner process.
    const root = await Deno.makeTempDir();
    const project = join(root, "remote-project");
    await Deno.mkdir(join(project, ".wld"), { recursive: true });
    await Deno.writeTextFile(
        join(project, ".wld", "settings.json"),
        JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } }),
    );
    const sentinel = `committed-${crypto.randomUUID()}`;
    await Deno.writeTextFile(join(project, "sentinel.txt"), sentinel);
    const laptopSecret = `laptop-only-${crypto.randomUUID()}`;
    const requests: Context[] = [];
    const stream: ProviderStreams["streamSimple"] = (_model, context, options) => {
        const result = createAssistantMessageEventStream();
        requests.push(context);
        const response = requests.length === 1
            ? fauxAssistantMessage(fauxToolCall("read_remote_sentinel", {}))
            : requests.length === 2
            ? fauxAssistantMessage(fauxText("uncommitted draft"), {
                stopReason: "error",
                errorMessage: `Unexpected EOF at https://${laptopSecret}.invalid/private`,
            })
            : fauxAssistantMessage(fauxText("Recovered with the tool result"));
        queueMicrotask(() => {
            if (options?.signal?.aborted) return;
            if (response.stopReason === "error") result.push({ type: "error", reason: "error", error: response });
            else result.push({ type: "done", reason: "stop", message: response });
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
        id: "laptop-only",
        name: "Laptop",
        models: [{
            provider: "laptop-only",
            id: "allowed",
            name: "Allowed",
            api: "openai-completions",
            baseUrl: `https://${laptopSecret}.invalid`,
            headers: { Authorization: laptopSecret },
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
    const mount: RemoteMount = { globalRoot: root, lost: new Promise<void>(() => {}), close: () => Promise.resolve() };
    try {
        let executions = 0;
        const tool = {
            name: "read_remote_sentinel",
            label: "Read remote sentinel",
            description: "Read the remote project file",
            parameters: { type: "object", properties: {} },
            execute: async () => {
                executions++;
                return {
                    content: [{ type: "text" as const, text: await Deno.readTextFile(join(project, "sentinel.txt")) }],
                    details: null,
                };
            },
        };
        const { session } = await createBoundedRemoteModelSession({
            mount,
            connection: { port: server.addr.transport === "tcp" ? server.addr.port : 0, credential },
            cwd: project,
            provider: "laptop-only",
            modelId: "allowed",
            customTools: [tool],
        });
        const retryDiagnostics: string[] = [];
        const unsubscribe = session.subscribe((event) => {
            if (
                event.type === "message_end" && event.message.role === "assistant" &&
                event.message.stopReason === "error"
            ) {
                retryDiagnostics.push(event.message.errorMessage ?? "");
            }
        });
        try {
            await session.prompt("Read the remote sentinel once");
            assertEquals(requests.length, 3);
            assertEquals(executions, 1);
            const second = JSON.stringify(requests[1].messages);
            const third = JSON.stringify(requests[2].messages);
            assertStringIncludes(second, sentinel);
            assertEquals(requests[2].messages.filter((message) => message.role === "toolResult").length, 1);
            assertStringIncludes(third, sentinel);
            assertEquals(third.includes("uncommitted draft"), false);
            assertEquals(retryDiagnostics, ["Network error: Unexpected EOF"]);
            assertStringIncludes(JSON.stringify(session.messages.at(-1)), "Recovered with the tool result");
            assertEquals(
                JSON.stringify({ requests, messages: session.messages, retryDiagnostics }).includes(laptopSecret),
                false,
            );
        } finally {
            unsubscribe();
            session.dispose();
        }
    } finally {
        bridge.close();
        await server.shutdown();
        await Deno.remove(root, { recursive: true });
    }
});
