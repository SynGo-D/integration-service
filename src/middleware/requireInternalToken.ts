import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { env } from "../config/env.js";

/**
 * Service-to-service authentication for `/internal/*` routes.
 *
 * These routes return webhook secrets — holding one is enough to forge
 * deliveries for a repository — so they must never be reachable by an
 * ordinary caller. Callers present `Authorization: Bearer <token>` with the
 * INTERNAL_SERVICE_TOKEN both services share.
 *
 * Fails closed when the token isn't configured: an unset variable must not
 * mean "no check". It answers 503 rather than 401 in that case because it's
 * a deployment fault on this side, not a bad credential on the caller's.
 */
export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
    const configured = env.INTERNAL_SERVICE_TOKEN;

    if (!configured) {
        res.status(503).json({
            success: false,
            message: "Internal API is not configured."
        });
        return;
    }

    const header = req.headers.authorization;
    const presented = typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : "";

    const expected = Buffer.from(configured, "utf8");
    const actual   = Buffer.from(presented, "utf8");

    // timingSafeEqual throws on a length mismatch, so compare lengths first;
    // that reveals only the length of a fixed-format secret.
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!valid) {
        res.status(401).json({
            success: false,
            message: "Unauthorized."
        });
        return;
    }

    next();
}
