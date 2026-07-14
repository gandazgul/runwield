import { reviewFileContentApi } from "../../routes/api/review-file-handlers.js";

/** @type {import("astro").APIRoute} */
export const GET = async ({ request }) => await reviewFileContentApi(request);
