import { reviewImageApi } from "../../routes/api/review-image-handlers.js";

/** @type {import("astro").APIRoute} */
export const GET = async ({ request }) => await reviewImageApi(request);
