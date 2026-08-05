import { Request, Response } from "express";
import axios from "axios";
import { RepositoryPreviewService } from "../services/RepositoryPreviewService";
import { AppError } from "../errors/AppError";

export class RepositoryPreviewController {
    private readonly repositoryPreviewService = new RepositoryPreviewService();

    async preview(req: Request, res: Response): Promise<void> {
        try {
            const url = req.query.url as string;
            const preview = await this.repositoryPreviewService.getRepositoryPreview(url);

            res.status(200).json(preview);
        } catch (error) {
            if (error instanceof AppError) {
                res.status(error.statusCode).json({
                    success: false,
                    message: error.message
                });
                return;
            }

            if (axios.isAxiosError(error) && error.response?.status === 404) {
                res.status(404).json({
                    success: false,
                    message: "Repository not found."
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
