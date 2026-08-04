import { NextFunction, Request, Response } from "express";
import { ValidationError } from "../errors/ValidationError";

export function validateConnectIntegration(req: Request, res: Response, next: NextFunction): void {
    const { provider, token, userId } = req.body;

    if (!provider || (provider !== "github" && provider !== "gitlab")) {
        throw new ValidationError("Provider must be either 'github' or 'gitlab'.");
    }

    if (!token || typeof token !== "string") {
        throw new ValidationError("Token is required and must be a string.");
    }

    if (!userId || typeof userId !== "string") {
        throw new ValidationError("userId is required and must be a string.");
    }

    next();
}

export function validateUUIDParam(req: Request, res: Response, next: NextFunction): void {
    const id = req.params.id;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (Array.isArray(id) || !uuidRegex.test(id)) {
        throw new ValidationError("Invalid UUID parameter.");
    }

    next();
}
