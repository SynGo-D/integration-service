import { Request, Response } from "express";
import { IntegrationService } from "../services/IntegrationService";
import { ConnectIntegrationRequest } from "../types/ConnectIntegrationRequest";

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

            res.status(200).json({
                success: true,
                integrations: result
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
            const integrationId = req.params.id;
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
            const integrationId = req.params.id;
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
}
