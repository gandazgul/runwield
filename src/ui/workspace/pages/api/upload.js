import { reviewImageUploadApi } from "../../routes/api/review-image-handlers.js";

/** @type {import("astro").APIRoute} */
export const POST = async ({ request }) => await reviewImageUploadApi(request);
