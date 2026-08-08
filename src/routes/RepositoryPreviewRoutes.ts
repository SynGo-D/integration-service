// src/routes/RepositoryPreviewRoutes.ts

import { Router } from "express";
import { RepositoryPreviewController } from "../controllers/RepositoryPreviewController.js";

/**
 * Mounts the repository preview route.
 *
 * GET /api/repositories/preview?url=<repository-url>
 *
 * Returns public metadata for a GitHub or GitLab repository
 * without requiring authentication.
 */
export function createRepositoryPreviewRoutes(
    controller: RepositoryPreviewController
): Router {
    const router = Router();

    router.get("/preview", (req, res) => controller.preview(req, res));

    return router;
}
