// src/routes/RepositoryPreviewRoutes.ts

import { Router } from "express";
import { RepositoryPreviewController } from "../controllers/RepositoryPreviewController.js";
import { previewLimiter, previewQuotaLimiter } from "../middleware/rateLimit.js";

/**
 * Mounts the repository preview route.
 *
 * GET /api/repositories/preview?url=<repository-url>
 *
 * Returns public metadata for a GitHub or GitLab repository
 * without requiring authentication.
 *
 * Two limiters, in order:
 *   1. previewQuotaLimiter — a service-wide hourly ceiling protecting the
 *      shared GitHub unauthenticated API quota (60/hour per source IP).
 *      Checked first so a single caller can't spend the whole budget before
 *      their own per-caller limit would have stopped them.
 *   2. previewLimiter — the per-caller limit for ordinary fair use.
 *
 * See middleware/rateLimit.ts for why these are keyed the way they are.
 */
export function createRepositoryPreviewRoutes(
    controller: RepositoryPreviewController
): Router {
    const router = Router();

    router.get(
        "/preview",
        previewQuotaLimiter,
        previewLimiter,
        (req, res) => controller.preview(req, res)
    );

    return router;
}
