import type { APIRoute } from "astro";

import { reviewLocalConfigApi } from "../../routes/api/review-file-handlers.js";

export const POST: APIRoute = () => reviewLocalConfigApi();
