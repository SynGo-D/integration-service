// src/routes/IntegrationRoutes.ts

import { Router } from "express";
import { IntegrationController } from "../controllers/IntegrationController.js";
import { validateAuthorizeRequest, validateUUIDParam } from "../middleware/validation.js";

/**
 * Mounts all integration-related routes onto the provided router.
 *
 * Route map:
 *
 *  Phase 1 — Single Repository Integration
 *  ────────────────────────────────────────────────────────────────────────
 *  GET    /api/repositories/preview?url=...          Repository metadata preview
 *  POST   /api/integrations/authorize                 Start OAuth (returns auth URL)
 *  GET    /api/integrations/:provider/oauth/callback   Provider callback (redirects)
 *  GET    /api/integrations?userId=...                List user's integrations
 *  GET    /api/integrations/:id                       Get single integration
 *  DELETE /api/integrations/:id                       Revoke integration
 *
 * The callback path is provider-specific (`:provider/oauth/callback`) because
 * each provider's OAuth app is registered with a single, exact-match redirect
 * URI (GitHub OAuth Apps in particular only support one). The handler itself
 * still cross-checks `:provider` against the provider encoded in the CSRF
 * `state` param before trusting it — see `IntegrationService.handleOAuthCallback`.
 *
 * Note: The `/:provider/oauth/callback` route MUST be declared before `/:id`
 * to prevent Express from interpreting the first path segment as a UUID id.
 */
export function createIntegrationRoutes(
    controller: IntegrationController
): Router {
    const router = Router();

    // OAuth flow — order matters: static paths before dynamic params
    router.post(
        "/authorize",
        validateAuthorizeRequest,
        (req, res) => controller.authorize(req, res)
    );

    router.get(
        "/:provider/oauth/callback",
        (req, res) => controller.oauthCallback(req, res)
    );

    // CRUD
    router.get(
        "/",
        (req, res) => controller.list(req, res)
    );

    router.get(
        "/:id",
        validateUUIDParam,
        (req, res) => controller.getById(req, res)
    );

    router.delete(
        "/:id",
        validateUUIDParam,
        (req, res) => controller.revoke(req, res)
    );

    return router;
}
