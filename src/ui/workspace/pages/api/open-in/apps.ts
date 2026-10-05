import type { APIRoute } from "astro";

import { reviewOpenInAppsApi } from "../../../routes/api/review-file-handlers.js";

export const GET: APIRoute = () => reviewOpenInAppsApi();
