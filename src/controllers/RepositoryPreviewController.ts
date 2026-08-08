// src/controllers/RepositoryPreviewController.ts

import { Request, Response } from "express";
import axios from "axios";
import { RepositoryPreviewService } from "../services/RepositoryPreviewService.js";
import { AppError } from "../errors/AppError.js";

/**
 * Handles the repository preview endpoint.
 *
 * GET /api/repositories/preview?url=<repository-url>
 *
 * This controller exists independently so that RepositoryPreviewRoutes
 * can be mounted separately from integration routes, which is useful
 * for testing the preview feature in isolation.
 */
export class RepositoryPreviewController {

    private readonly repositoryPreviewService: RepositoryPreviewService;

    constructor(repositoryPreviewService?: RepositoryPreviewService) {
        this.repositoryPreviewService =
            repositoryPreviewService ?? new RepositoryPreviewService();
    }

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

            if (error instanceof AppError) {
                res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            // Handle provider API 404 (repository not found or private)
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;

                if (status === 404) {
                    res.status(404).json({
                        success: false,
                        message: "Repository not found. It may be private or the URL is incorrect."
                    });
                    return;
                }

                if (status === 403 || status === 401) {
                    res.status(422).json({
                        success: false,
                        message: "The repository is private and requires authorization."
                    });
                    return;
                }
            }

            console.error("RepositoryPreviewController error:", error);
            res.status(500).json({
                success: false,
                message: "An internal server error occurred."
            });
        }
    };
}
