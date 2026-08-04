import { Router } from "express";
import { IntegrationController } from "../controllers/IntegrationController";

export function createIntegrationRoutes(
    controller: IntegrationController
): Router {

    const router = Router();

    router.post(
        "/connect",
        (req, res) => controller.connectRepository(req, res)
    );

    return router;

}