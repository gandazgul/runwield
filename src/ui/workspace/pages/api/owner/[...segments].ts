export const prerender = false;

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const GET = () => {
    if (!import.meta.env.DEV) return json({ error: "Not found." }, 404);
    return json({
        error:
            "Owner Session APIs are not available from workspace:dev. Open the paired owner Workspace server to use real Session data.",
    }, 503);
};

export const POST = GET;
