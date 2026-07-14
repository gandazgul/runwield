import { reviewOpenInAppsApi } from "../../../routes/api/review-file-handlers.js";

/** @type {import("astro").APIRoute} */
export const GET = () => reviewOpenInAppsApi();
