import { Request, Response } from "express";
import { IntegrationService } from "../services/IntegrationService";
import { ConnectRepositoryRequest } from "../types/ConnectRepositoryRequest";

/**
 * Handles HTTP requests for repository connections.
 */
export class IntegrationController {

    constructor(
        private readonly integrationService: IntegrationService
    ) {}

    /**
     * Connect endpoint.
     */
    async connectRepository(req: Request, res: Response): Promise<void> {

        try {

            const body = req.body as ConnectRepositoryRequest;

            const result =
                await this.integrationService.connect(body.url);

            res.status(200).json(result);

        }

        catch (error) {

            res.status(400).json({

                success: false,

                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown error"

            });

        }

    }

}