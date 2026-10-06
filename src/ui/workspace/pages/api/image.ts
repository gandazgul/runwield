import type { APIRoute } from "astro";

import { reviewImageApi } from "../../routes/api/review-image-handlers.js";

export const GET: APIRoute = async ({ request }) => await reviewImageApi(request);
