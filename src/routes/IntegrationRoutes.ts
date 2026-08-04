import { Router } from "express";
import { IntegrationController } from "../controllers/IntegrationController";

export function createIntegrationRoutes(
    controller: IntegrationController
): Router {
    const router = Router();

    router.post("/connect", (req, res) => controller.connect(req, res));
    router.get("/", (req, res) => controller.list(req, res));
    router.post("/:id/sync", (req, res) => controller.sync(req, res));
    router.get("/:id/repositories", (req, res) => controller.listRepositories(req, res));

    return router;
}
