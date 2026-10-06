import type { APIRoute } from "astro";

import { reviewImageUploadApi } from "../../routes/api/review-image-handlers.js";

export const POST: APIRoute = async ({ request }) => await reviewImageUploadApi(request);
