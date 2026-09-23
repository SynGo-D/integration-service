// src/middleware/validation.ts

import { NextFunction, Request, Response } from "express";
import { ValidationError } from "../errors/ValidationError.js";

/**
 * Validates the `userId`, `provider`, and `repositoryUrl` fields
 * for the authorize endpoint.
 *
 * Usage:
 *   router.post("/authorize", validateAuthorizeRequest, controller.authorize)
 */
export function validateAuthorizeRequest(
    req:  Request,
    _res: Response,
    next: NextFunction
): void {
    const { userId, repositoryUrl } = req.body as Record<string, unknown>;

    if (!userId || typeof userId !== "string") {
        throw new ValidationError("userId is required and must be a string.");
    }

    if (!repositoryUrl || typeof repositoryUrl !== "string") {
        throw new ValidationError("repositoryUrl is required and must be a string.");
    }

    next();
}

/**
 * Validates that a route parameter named `id` is a valid UUID v4.
 *
 * Usage:
 *   router.get("/:id", validateUUIDParam, controller.getById)
 */
export function validateUUIDParam(
    req:  Request,
    _res: Response,
    next: NextFunction
): void {
    const id       = req.params.id;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

    if (Array.isArray(id) || !uuidRegex.test(id)) {
        throw new ValidationError("Invalid UUID parameter.");
    }

    next();
}
