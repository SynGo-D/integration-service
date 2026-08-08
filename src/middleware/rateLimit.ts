// src/middleware/rateLimit.ts

import { NextFunction, Request, Response } from "express";

/**
 * Rate limiting middleware.
 *
 * Currently a pass-through placeholder.
 *
 * For production, replace with one of:
 *  • express-rate-limit (in-memory, single-instance)
 *  • rate-limiter-flexible with Redis (distributed, multi-instance)
 *
 * Recommended limits for Phase 1:
 *  • Preview endpoint:   30 requests / minute per IP
 *  • Authorize endpoint: 10 requests / minute per IP
 *  • OAuth callback:     no limit (called by the provider, not the user)
 */
export function rateLimiter(
    _req:  Request,
    _res:  Response,
    next:  NextFunction
): void {
    next();
}
