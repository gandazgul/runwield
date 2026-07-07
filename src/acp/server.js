/**
 * @module acp/server
 * Minimal RunWield ACP stdio server skeleton.
 */

import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

const ACP_NOT_IMPLEMENTED = -32004;

/** @typedef {import('@agentclientprotocol/sdk').AgentApp} AgentApp */
/** @typedef {import('@agentclientprotocol/sdk').AgentConnection} AgentConnection */

/**
 * @typedef {Object} RunWieldAcpServerOptions
 * @property {(message: string) => void | Promise<void>} [diagnostic]
 */

/**
 * Build the stable initialize response for the ACP MVP skeleton.
 *
 * @param {import('@agentclientprotocol/sdk').InitializeRequest | undefined} request
 * @returns {import('@agentclientprotocol/sdk').InitializeResponse}
 */
export function createInitializeResponse(request) {
    return {
        protocolVersion: request?.protocolVersion || PROTOCOL_VERSION,
        agentCapabilities: {},
        authMethods: [],
        agentInfo: { name: "RunWield", version: "0.0.0-acp-mvp" },
    };
}

/**
 * @param {string} method
 * @returns {never}
 */
function throwUnimplemented(method) {
    throw new RequestError(ACP_NOT_IMPLEMENTED, `RunWield ACP method is not implemented yet: ${method}`, {
        method,
        phase: "session-runtime-acp-mvp",
    });
}

/**
 * @param {AgentApp} app
 * @param {import('@agentclientprotocol/sdk').AgentRequestMethod} method
 */
function registerUnimplementedRequest(app, method) {
    app.onRequest(method, () => throwUnimplemented(method));
}

/**
 * Create the minimal RunWield ACP agent app.
 *
 * @returns {AgentApp}
 */
export function createRunWieldAcpServer() {
    const app = agent({ name: "RunWield ACP MVP" });

    app.onRequest(methods.agent.initialize, (context) => createInitializeResponse(context.params));

    registerUnimplementedRequest(app, methods.agent.authenticate);
    registerUnimplementedRequest(app, methods.agent.logout);
    registerUnimplementedRequest(app, methods.agent.providers.list);
    registerUnimplementedRequest(app, methods.agent.providers.set);
    registerUnimplementedRequest(app, methods.agent.providers.disable);
    registerUnimplementedRequest(app, methods.agent.session.new);
    registerUnimplementedRequest(app, methods.agent.session.load);
    registerUnimplementedRequest(app, methods.agent.session.list);
    registerUnimplementedRequest(app, methods.agent.session.delete);
    registerUnimplementedRequest(app, methods.agent.session.fork);
    registerUnimplementedRequest(app, methods.agent.session.resume);
    registerUnimplementedRequest(app, methods.agent.session.close);
    registerUnimplementedRequest(app, methods.agent.session.setMode);
    registerUnimplementedRequest(app, methods.agent.session.setConfigOption);
    registerUnimplementedRequest(app, methods.agent.session.prompt);
    registerUnimplementedRequest(app, methods.agent.nes.start);
    registerUnimplementedRequest(app, methods.agent.nes.suggest);
    registerUnimplementedRequest(app, methods.agent.nes.close);

    return app;
}

/**
 * Start the RunWield ACP server on newline-delimited JSON streams.
 *
 * @param {ReadableStream<Uint8Array>} input
 * @param {WritableStream<Uint8Array>} output
 * @param {RunWieldAcpServerOptions} [options]
 * @returns {AgentConnection}
 */
export function startRunWieldAcpServer(input, output, options = {}) {
    const stream = ndJsonStream(output, input);
    const connection = createRunWieldAcpServer().connect(stream);
    const diagnostics = options.diagnostic;
    if (diagnostics) diagnostics("RunWield ACP stdio server started");
    return connection;
}
