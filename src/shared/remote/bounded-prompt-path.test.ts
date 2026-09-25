import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createBoundedRemoteModelSession } from "./bounded-model-session.ts";
import { handleModelRequest, LocalModelBridge } from "./model-bridge.ts";

Deno.test("bounded Pi loader rejects a personal prompt link into a server file", async () => {
    const root = await Deno.makeTempDir();
    const project = join(root, "project");
    const personal = join(root, "personal");
    await Deno.mkdir(project);
    await Deno.mkdir(join(personal, "prompts"), { recursive: true });
    const serverFile = join(root, "server-secret.md");
    await Deno.writeTextFile(serverFile, "server-only");
    await Deno.symlink(serverFile, join(personal, "prompts", "example.md"));
    const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    runtime.registerNativeProvider(createProvider({
        id: "test-local",
        name: "Test",
        models: [{
            provider: "test-local",
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
        api: {
            stream: () => {
                throw new Error("No turn expected");
            },
            streamSimple: () => {
                throw new Error("No turn expected");
            },
        },
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
    try {
        await assertRejects(
            () =>
                createBoundedRemoteModelSession({
                    mount: { globalRoot: personal, lost: new Promise<void>(() => {}), close: () => Promise.resolve() },
                    connection: { port: server.addr.transport === "tcp" ? server.addr.port : 0, credential },
                    cwd: project,
                    provider: "test-local",
                    modelId: "test",
                }),
            Error,
            "resolved outside mounted roots",
        );
    } finally {
        bridge.close();
        await server.shutdown();
        await Deno.remove(root, { recursive: true });
    }
});
