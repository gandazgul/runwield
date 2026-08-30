import {
    DEV_OWNER_DEVICE,
    DEV_OWNER_PROJECT,
    devOwnerSessionOptions,
    devOwnerSessionPage,
    devOwnerSidebar,
    devOwnerTimeline,
} from "../../../server/dev-owner-fixtures.ts";

export const prerender = false;

function json<T>(body: T, status = 200) {
    return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function pageValue(url: URL, name: string, fallback: number) {
    const value = url.searchParams.get(name);
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function routeSegments(context: { params: { segments?: string } }) {
    return String(context.params.segments || "").split("/").filter(Boolean);
}

export const GET = ({ request, params }: { request: Request; params: { segments?: string } }) => {
    if (!import.meta.env.DEV) return json({ error: "Not found." }, 404);
    const segments = routeSegments({ params });
    const url = new URL(request.url);

    if (segments.join("/") === "sidebar") return json(devOwnerSidebar());
    if (segments.join("/") === "projects") return json({ projects: [DEV_OWNER_PROJECT] });
    if (segments.join("/") === "devices") {
        return json({ devices: [DEV_OWNER_DEVICE], currentDeviceId: DEV_OWNER_DEVICE.deviceId });
    }

    if (segments[0] === "projects" && segments[1] === DEV_OWNER_PROJECT.projectId) {
        if (segments[2] === "session-options") return json(devOwnerSessionOptions());
        if (segments[2] === "sessions" && segments.length === 3) {
            return json(devOwnerSessionPage(pageValue(url, "page", 0), pageValue(url, "pageSize", 30)));
        }
        if (segments[2] === "sessions" && segments[4] === "timeline") {
            return json(devOwnerTimeline(segments[3] || ""));
        }
    }

    return json({ error: "Dev owner API route not found." }, 404);
};

export const POST = ({ params }: { params: { segments?: string } }) => {
    if (!import.meta.env.DEV) return json({ error: "Not found." }, 404);
    const segments = routeSegments({ params });
    if (segments.join("/") === "projects") return json({ project: DEV_OWNER_PROJECT }, 201);
    if (segments[0] === "projects" && segments[1] === DEV_OWNER_PROJECT.projectId && segments[2] === "action") {
        return json({ projects: [DEV_OWNER_PROJECT], diagnostics: [] });
    }
    if (segments[0] === "devices" && segments[2] === "revoke") return json({ device: DEV_OWNER_DEVICE });
    return json({ status: "accepted", operationId: "dev-operation", runwieldSessionId: null, generation: null }, 202);
};
