// src/controllers/IntegrationController.ts

import { Request, Response } from "express";
import axios from "axios";
import { IntegrationService } from "../services/IntegrationService.js";
import { RepositoryPreviewService } from "../services/RepositoryPreviewService.js";
import { AppError } from "../errors/AppError.js";
import { env } from "../config/env.js";

/**
 * HTTP controller for all integration-related endpoints.
 *
 * Responsibilities:
 *  • Parse and validate HTTP request parameters
 *  • Delegate to the service layer
 *  • Format and return HTTP responses
 *  • NEVER contain business logic
 *
 * Endpoints handled:
 *  GET  /api/repositories/preview?url=...       — public metadata preview
 *  POST /api/integrations/authorize              — start OAuth (returns redirect URL)
 *  GET  /api/integrations/oauth/callback         — OAuth provider callback
 *  GET  /api/integrations?userId=...             — list user's integrations
 *  GET  /api/integrations/:id                    — get single integration
 *  DELETE /api/integrations/:id                  — revoke integration
 */
export class IntegrationController {

    constructor(
        private readonly integrationService: IntegrationService,
        private readonly repositoryPreviewService: RepositoryPreviewService
    ) {}

    // -----------------------------------------------------------------------
    // Step 1: Preview
    // -----------------------------------------------------------------------

    /**
     * GET /api/repositories/preview?url=<repository-url>
     *
     * Returns public metadata for a repository without authentication.
     * Supports both GitHub and GitLab URLs.
     */
    preview = async (req: Request, res: Response): Promise<void> => {
        try {
            const url = req.query.url as string;

            if (!url) {
                res.status(400).json({
                    success: false,
                    message: "Query parameter 'url' is required."
                });
                return;
            }

            const preview = await this.repositoryPreviewService.getRepositoryPreview(url);

            res.status(200).json({
                success: true,
                data:    preview
            });

        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------
    // Step 2: Authorize — initiate provider OAuth flow
    // -----------------------------------------------------------------------

    /**
     * POST /api/integrations/authorize
     * Body: { userId: string, repositoryUrl: string }
     *
     * Creates a PENDING integration row and returns the OAuth authorization URL.
     * The frontend redirects the user to `authorizationUrl`.
     */
    authorize = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, repositoryUrl, organizationId, projectId } = req.body as {
                userId:         string;
                organizationId: string;
                projectId?:     string | null;
                repositoryUrl: string;
            };

            if (!userId || !repositoryUrl || !organizationId) {
                res.status(400).json({
                    success: false,
                    message: "userId, repositoryUrl and organizationId are required."
                });
                return;
            }

            const result = await this.integrationService.initiateOAuth(
                userId,
                repositoryUrl,
                organizationId,
                projectId ?? null
            );

            res.status(200).json({
                success: true,
                data: {
                    integrationId:    result.integrationId,
                    authorizationUrl: result.authorizationUrl
                }
            });

        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------
    // Step 3: OAuth callback — provider redirects back here
    // -----------------------------------------------------------------------

    /**
     * GET /api/integrations/:provider/oauth/callback?code=...&state=...
     *
     * Handles both GitHub and GitLab callbacks via the `:provider` route
     * segment (required because each provider's OAuth app is registered
     * with a single, exact-match redirect URI). The handler still verifies
     * `:provider` against the provider encoded in the CSRF `state` param
     * before trusting it.
     *
     * On success: redirects the user to FRONTEND_SUCCESS_URL.
     * On failure: redirects the user to FRONTEND_ERROR_URL.
     */
    oauthCallback = async (req: Request, res: Response): Promise<void> => {
        // Express 5 types route params as string | string[]; this route
        // declares :provider once, so it is always the single value.
        const provider = String(req.params.provider ?? "");
        const code  = req.query.code  as string | undefined;
        const state = req.query.state as string | undefined;

        // Provider may return an error instead of a code
        const error = req.query.error as string | undefined;
        if (error) {
            const description = req.query.error_description as string ?? error;
            console.error(`OAuth provider returned error: ${description}`);
            res.redirect(
                `${env.FRONTEND_ERROR_URL}?error=${encodeURIComponent(description)}`
            );
            return;
        }

        if (!code || !state) {
            res.redirect(
                `${env.FRONTEND_ERROR_URL}?error=missing_code_or_state`
            );
            return;
        }

        try {
            const integration = await this.integrationService.handleOAuthCallback(
                code,
                state,
                provider
            );

            res.redirect(
                `${env.FRONTEND_SUCCESS_URL}` +
                `?integrationId=${integration.id}` +
                `&provider=${integration.provider}` +
                `&repo=${encodeURIComponent(
                    `${integration.repositoryOwner}/${integration.repositoryName}`
                )}` +
                `&userId=${integration.userId}`
            );

        } catch (err) {
            console.error("OAuth callback error:", err);
            const message = err instanceof Error ? err.message : "oauth_failed";
            res.redirect(
                `${env.FRONTEND_ERROR_URL}?error=${encodeURIComponent(message)}`
            );
        }
    };

    // -----------------------------------------------------------------------
    // Query operations
    // -----------------------------------------------------------------------

    /**
     * GET /api/integrations?userId=<uuid>[&organizationId=<uuid>][&projectId=<uuid>]
     *
     * With organizationId: every repository that organization has
     * connected, optionally narrowed to one project — any member may read
     * them. Without it: only what this user connected themselves, which is
     * what the pre-multi-tenant clients ask for.
     *
     * Tokens are stripped from the response — never returned to the client.
     */
    list = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.query.userId as string;
            const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
            const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;

            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: "Query parameter 'userId' is required."
                });
                return;
            }

            const integrations = organizationId
                ? await this.integrationService.getOrganizationIntegrations(organizationId, userId, projectId)
                : await this.integrationService.getIntegrations(userId);

            res.status(200).json({
                success: true,
                data:    integrations.map(this.sanitize)
            });

        } catch (error) {
            this.handleError(res, error);
        }
    };

    /**
     * GET /api/integrations/:id
     *
     * Returns a single integration by its UUID.
     * Access token is never returned in the response.
     */
    /**
     * GET /api/integrations/access?owner=&repo=&provider=
     *
     * Answers one question for main-backend's gateway: may the caller
     * (X-User-Id) see this repository? 404 rather than 403 when not, the
     * same choice OrganizationService makes — a "forbidden" would confirm
     * that a repository is connected to some other organization.
     */
    checkAccess = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.header("X-User-Id") ?? "";
            const owner = String(req.query.owner ?? "");
            const repo = String(req.query.repo ?? "");
            const provider = String(req.query.provider ?? "github") as "github" | "gitlab";

            const allowed = await this.integrationService.userCanAccessRepository(
                userId, provider, owner, repo
            );

            if (!allowed) {
                res.status(404).json({ success: false, message: "Repository not found." });
                return;
            }

            res.status(200).json({ success: true, data: { allowed: true } });
        } catch (error) {
            console.error("[integrations] access check failed:", error);
            // Fail closed: an error here must not become access.
            res.status(404).json({ success: false, message: "Repository not found." });
        }
    };

    getById = async (req: Request, res: Response): Promise<void> => {
        try {
            const id = req.params.id as string;
            const integration = await this.integrationService.getIntegrationById(id);

            res.status(200).json({
                success: true,
                data:    this.sanitize(integration)
            });

        } catch (error) {
            this.handleError(res, error);
        }
    };

    /**
     * DELETE /api/integrations/:id
     *
     * Revokes (soft-deletes) an integration.
     */
    revoke = async (req: Request, res: Response): Promise<void> => {
        try {
            const id = req.params.id as string;
            await this.integrationService.revokeIntegration(id);

            res.status(200).json({
                success: true,
                message: "Integration revoked successfully."
            });

        } catch (error) {
            this.handleError(res, error);
        }
    };

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Removes sensitive fields before sending integration data to the client.
     * Access tokens must NEVER be returned in API responses.
     */
    private sanitize(integration: ReturnType<IntegrationService["getIntegrationById"]> extends Promise<infer T> ? T : never) {
        return {
            id:              integration.id,
            userId:          integration.userId,
            provider:        integration.provider,
            repositoryUrl:   integration.repositoryUrl,
            repositoryOwner: integration.repositoryOwner,
            repositoryName:  integration.repositoryName,
            providerUsername: integration.providerUsername,
            status:          integration.status,
            webhookRegistered: Boolean(integration.providerWebhookId),
            createdAt:       integration.createdAt,
            updatedAt:       integration.updatedAt
        };
    }

    /**
     * Centralised error handler for controller methods.
     */
    private handleError(res: Response, error: unknown): void {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({
                success: false,
                message: error.message
            });
            return;
        }

        if (axios.isAxiosError(error)) {
            const status = error.response?.status;

            if (status === 404) {
                res.status(404).json({
                    success: false,
                    message: "Repository not found."
                });
                return;
            }

            if (status === 403 || status === 401) {
                res.status(422).json({
                    success: false,
                    message: "The repository is private or does not exist."
                });
                return;
            }
        }

        console.error("Unhandled controller error:", error);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred."
        });
    }
}
