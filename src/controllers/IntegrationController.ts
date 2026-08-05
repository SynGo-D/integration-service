import { Request, Response } from "express";
import { IntegrationService } from "../services/IntegrationService";
import { ConnectIntegrationRequest } from "../types/ConnectIntegrationRequest";
import { AppError } from "../errors/AppError";

export class IntegrationController {
    constructor(
        private readonly integrationService: IntegrationService
    ) {}

    async connect(req: Request, res: Response): Promise<void> {
        try {
            const body = req.body as ConnectIntegrationRequest;
            const result = await this.integrationService.connect(
                body.provider,
                body.token,
                body.userId
            );

            res.status(201).json({
                success: true,
                integrationId: result.id
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    async list(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.query.userId as string;
            const result = await this.integrationService.getIntegrations(userId);

            const sanitized = result.map(({ id, userId: uid, provider, status, createdAt, updatedAt }) => ({
                id,
                userId: uid,
                provider,
                status,
                createdAt,
                updatedAt
            }));

            res.status(200).json({
                success: true,
                integrations: sanitized
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    async sync(req: Request, res: Response): Promise<void> {
        try {
            const integrationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            await this.integrationService.sync(integrationId);

            res.status(200).json({
                success: true
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    async listRepositories(req: Request, res: Response): Promise<void> {
        try {
            const integrationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            const result = await this.integrationService.getRepositories(integrationId);

            res.status(200).json({
                success: true,
                repositories: result
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                message: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    async startGithubOAuth(req: Request, res: Response): Promise<void> {
        try {
            const userId = req.query.userId as string;
            const redirectUrl = await this.integrationService.generateGithubAuthorizationUrl(userId);
            res.redirect(302, redirectUrl);
        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: "Internal server error."
            });
        }
    }

    async githubOAuthCallback(req: Request, res: Response): Promise<void> {
        try {
            const code = req.query.code as string;
            const state = req.query.state as string;
            const result = await this.integrationService.handleGithubOAuthCallback(code, state);

            res.status(200).json(result);
        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: "Internal server error."
            });
        }
    }
}
