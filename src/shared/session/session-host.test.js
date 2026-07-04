import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { SessionHost } from "./session-host.js";

/**
 * @param {string} id
 * @param {string} cwd
 */
function makeSessionManager(id, cwd = `/work/${id}`) {
    return {
        getSessionId: () => id,
        getCwd: () => cwd,
        disposed: false,
        dispose() {
            this.disposed = true;
        },
    };
}

Deno.test("SessionHost creates sessions with deterministic ids and owns lookup metadata", () => {
    const sessionManager = makeSessionManager("manager-alpha", "/repo/alpha");
    const host = new SessionHost();

    const session = host.createSession({ id: "alpha", cwd: "/fallback/alpha", sessionManager });

    assertEquals(session instanceof HostedSession, true);
    assertEquals(session.id, "manager-alpha");
    assertEquals(session.cwd, "/repo/alpha");
    assertStrictEquals(session.getRootSessionManager(), sessionManager);
    assertStrictEquals(host.getSession("manager-alpha"), session);
    assertStrictEquals(host.requireSession("manager-alpha"), session);
    assertEquals(host.listSessions(), [
        { id: "manager-alpha", cwd: "/repo/alpha", sessionManagerId: "manager-alpha", disposed: false },
    ]);
});

Deno.test("SessionHost can adopt an existing HostedSession", () => {
    const hostedSession = new HostedSession({
        id: "adopted",
        cwd: "/repo/adopted",
        sessionManager: makeSessionManager("adopted-manager", "/repo/adopted"),
    });
    const host = new SessionHost();

    const adopted = host.adoptSession(hostedSession);

    assertStrictEquals(adopted, hostedSession);
    assertStrictEquals(host.getSession("adopted-manager"), hostedSession);
    assertEquals(host.listSessions(), [
        { id: "adopted-manager", cwd: "/repo/adopted", sessionManagerId: "adopted-manager", disposed: false },
    ]);
});

Deno.test("SessionHost prefers SessionManager ids over provided or generated ids", () => {
    let idFactoryCalls = 0;
    const host = new SessionHost({ idFactory: () => `generated-${++idFactoryCalls}` });

    const first = host.createSession({ cwd: "/repo/one", sessionManager: makeSessionManager("one") });
    const second = host.createSession({
        id: "provided-two",
        cwd: "/repo/two",
        sessionManager: makeSessionManager("two"),
    });

    assertEquals(first.id, "one");
    assertEquals(second.id, "two");
    assertEquals(idFactoryCalls, 0);
    assertEquals(host.listSessions().map((session) => session.id), ["one", "two"]);
});

Deno.test("SessionHost falls back to provided or generated ids when SessionManager has none", () => {
    let next = 0;
    const host = new SessionHost({ idFactory: () => `generated-${++next}` });

    const first = host.createSession({ id: "provided", cwd: "/repo/provided", sessionManager: null });
    const second = host.createSession({ cwd: "/repo/generated", sessionManager: null });

    assertEquals(first.id, "provided");
    assertEquals(second.id, "generated-1");
    assertEquals(host.listSessions().map((session) => session.id), ["provided", "generated-1"]);
});

Deno.test("SessionHost requireSession fails clearly when the session is missing", () => {
    const host = new SessionHost();

    assertEquals(host.getSession("missing"), null);
    assertThrows(
        () => host.requireSession("missing"),
        Error,
        'HostedSession "missing" was not found',
    );
});

Deno.test("SessionHost rejects duplicate ids for created or adopted sessions", () => {
    const host = new SessionHost();

    host.createSession({ id: "duplicate", cwd: "/repo/duplicate", sessionManager: makeSessionManager("duplicate") });

    assertThrows(
        () =>
            host.createSession({
                id: "duplicate-fallback",
                cwd: "/repo/duplicate-2",
                sessionManager: makeSessionManager("duplicate"),
            }),
        Error,
        'HostedSession "duplicate" already exists',
    );
    assertThrows(
        () =>
            host.adoptSession(
                new HostedSession({
                    id: "duplicate-fallback",
                    cwd: "/repo/adopted",
                    sessionManager: makeSessionManager("duplicate"),
                }),
            ),
        Error,
        'HostedSession "duplicate" already exists',
    );
});

Deno.test("SessionHost disposeSession removes and disposes only the target HostedSession", () => {
    const alphaManager = makeSessionManager("alpha-manager");
    const betaManager = makeSessionManager("beta-manager");
    const host = new SessionHost();
    const alpha = host.createSession({ id: "alpha", cwd: "/repo/alpha", sessionManager: alphaManager });
    const beta = host.createSession({ id: "beta", cwd: "/repo/beta", sessionManager: betaManager });

    assertEquals(host.disposeSession("alpha-manager"), true);

    assertEquals(alpha.disposed, true);
    assertEquals(alphaManager.disposed, true);
    assertEquals(beta.disposed, false);
    assertEquals(betaManager.disposed, false);
    assertEquals(host.getSession("alpha-manager"), null);
    assertStrictEquals(host.getSession("beta-manager"), beta);
    assertEquals(host.listSessions(), [
        { id: "beta-manager", cwd: "/work/beta-manager", sessionManagerId: "beta-manager", disposed: false },
    ]);
    assertEquals(host.disposeSession("missing"), false);
});
