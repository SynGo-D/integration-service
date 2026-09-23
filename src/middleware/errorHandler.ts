// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Global error-handling middleware.
 *
 * Must be registered LAST in app.ts (after all routes) so that
 * errors thrown anywhere in the stack bubble up here.
 *
 * Behaviour:
 *  • AppError and subclasses → use the error's statusCode + message
 *  • Any other error         → 500 Internal Server Error
 *
 * The raw error is logged to stderr in development; in production a
 * structured logger should be used instead.
 */
export function errorHandler(
    err:  Error,
    req:  Request,
    res:  Response,
    _next: NextFunction
): void {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            message: err.message
        });
        return;
    }

    console.error("[ErrorHandler]", err);

    res.status(500).json({
        success: false,
        message: "An internal server error occurred."
    });
}
