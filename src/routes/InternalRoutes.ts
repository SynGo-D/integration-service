// src/routes/InternalRoutes.ts

import { Router, Request, Response } from "express";
import { IntegrationService } from "../services/IntegrationService.js";
import { requireInternalToken } from "../middleware/requireInternalToken.js";
import { AppError } from "../errors/AppError.js";

/**
 * Service-to-service routes. Not for browsers and not proxied by
 * main-backend — every route here sits behind requireInternalToken.
 *
 *   GET /internal/webhook-secrets?provider=github&repository=acme/shop
 *       → { success, data: { secrets: string[], legacy: boolean } }
 *
 * Used by webhook-listener to verify each delivery against the secret of
 * the integration it claims to belong to (see
 * IntegrationService.getWebhookSecrets).
 */
export function createInternalRoutes(integrationService: IntegrationService): Router {
    const router = Router();

    router.use(requireInternalToken);

    router.get("/webhook-secrets", async (req: Request, res: Response) => {
        const provider   = typeof req.query.provider === "string" ? req.query.provider : "";
        const repository = typeof req.query.repository === "string" ? req.query.repository : "";

        try {
            const data = await integrationService.getWebhookSecrets(provider, repository);

            // These are credentials — never let an intermediary cache them.
            res.setHeader("Cache-Control", "no-store");
            res.status(200).json({ success: true, data });

        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
                return;
            }
            console.error("[internal] webhook secret lookup failed:", error);
            res.status(500).json({ success: false, message: "Lookup failed." });
        }
    });

    return router;
}
