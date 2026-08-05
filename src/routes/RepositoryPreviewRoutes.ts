import { Router } from "express";
import { RepositoryPreviewController } from "../controllers/RepositoryPreviewController";

export function createRepositoryPreviewRoutes(
    controller: RepositoryPreviewController
): Router {
    const router = Router();

    router.get("/preview", (req, res) => controller.preview(req, res));

    return router;
}
