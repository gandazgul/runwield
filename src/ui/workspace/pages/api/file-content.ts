import type { APIRoute } from "astro";

import { reviewFileContentApi } from "../../routes/api/review-file-handlers.js";

export const GET: APIRoute = async ({ request }) => await reviewFileContentApi(request);
