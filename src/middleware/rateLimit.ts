// src/middleware/rateLimit.ts

import { Request } from "express";
import { rateLimit, ipKeyGenerator, MINUTE, HOUR } from "express-rate-limit";

/**
 * Rate limiting for the Integration Service.
 *
 * ---------------------------------------------------------------------------
 * Why this isn't just "limit by IP"
 * ---------------------------------------------------------------------------
 * Almost nothing reaches this service directly from a browser. `main-backend`
 * is the only public entry point, and it calls us server-to-server with plain
 * `fetch` — so /preview, /authorize, and the CRUD routes all arrive from a
 * single source IP no matter how many different users are behind them.
 *
 * A naive per-IP limiter would therefore be worse than none: one abusive user
 * would exhaust the shared bucket and lock out everyone else, while the
 * attacker's own traffic looks identical to legitimate traffic.
 *
 * So each route is keyed by the most specific identity actually available:
 *
 *   /authorize          → userId from the request body. main-backend derives
 *                         this from a verified JWT, so a caller coming through
 *                         the gateway cannot forge another user's identity.
 *   GET /integrations   → userId from the query string, same reasoning.
 *   OAuth callback      → the real client IP. This is the one route a user's
 *                         *browser* hits directly (the provider redirects the
 *                         browser here), so IP is meaningful.
 *   everything else     → client IP, as a coarse backstop.
 *
 * ---------------------------------------------------------------------------
 * The preview ceiling is the important one
 * ---------------------------------------------------------------------------
 * `getPublicRepositoryMetadata` calls GitHub *unauthenticated*, and GitHub
 * allows only **60 unauthenticated requests per hour per source IP**. Since
 * every user's preview leaves from this server's single IP, that 60/hour is a
 * shared, service-wide budget — one user can exhaust it for everybody.
 *
 * `previewQuotaLimiter` below is a deliberate service-wide bucket (one fixed
 * key, not per-user) sized just under GitHub's limit. It doesn't create more
 * quota — nothing can — but it means we fail with our own clear 429 rather
 * than GitHub's opaque 403, and one user can't silently consume the lot.
 *
 * The real fix for that is to give the preview call a GitHub token (raising
 * the ceiling to 5,000/hour); this limiter is the guard that should stay
 * either way.
 *
 * ---------------------------------------------------------------------------
 * Deployment assumption
 * ---------------------------------------------------------------------------
 * userId-based keys assume this service is not directly reachable from the
 * public internet — only main-backend and provider OAuth redirects should be
 * able to reach it. If that stops being true, a caller could hit :5001
 * directly and pass any userId. Enforce it at the network layer (security
 * group / container network), not here.
 */

/** Shape of the body/query fields we key on, without trusting them as types. */
function userIdFrom(req: Request): string | undefined {
    const fromBody  = (req.body  as { userId?: unknown } | undefined)?.userId;
    const fromQuery = (req.query as { userId?: unknown } | undefined)?.userId;
    const candidate = typeof fromBody === "string" ? fromBody : fromQuery;

    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * Keys on the caller's user ID when one is present, falling back to their IP.
 *
 * `ipKeyGenerator` is used rather than `req.ip` directly so IPv6 clients are
 * grouped by subnet — otherwise a single IPv6 host can trivially rotate
 * through addresses in its own /64 and bypass the limit entirely.
 */
function userOrIpKey(req: Request): string {
    const userId = userIdFrom(req);
    return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

function ipKey(req: Request): string {
    return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** Consistent JSON error shape, matching the service's `{ success, message }` envelope. */
function tooManyRequests(message: string) {
    return {
        success: false,
        message
    };
}

// ---------------------------------------------------------------------------
// Limiters
// ---------------------------------------------------------------------------

/**
 * Coarse global backstop. Generous on purpose: it exists to stop a runaway
 * client or a crude flood, not to police normal use — the per-route limiters
 * below do the real work. Health checks are exempt so monitoring never trips
 * it.
 */
export const globalLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 300,
    keyGenerator: ipKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
    message: tooManyRequests("Too many requests. Please slow down.")
});

/**
 * Per-caller preview limit. Previews are cheap for us but expensive against
 * GitHub's unauthenticated quota, so this is tighter than it looks necessary.
 */
export const previewLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 30,
    keyGenerator: userOrIpKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooManyRequests("Too many repository previews. Please wait a moment and try again.")
});

/**
 * Service-wide ceiling protecting the shared GitHub unauthenticated quota
 * (60/hour per source IP). One fixed key — this is intentionally NOT
 * per-user; it's a budget for the whole process.
 *
 * 50 leaves headroom for other unauthenticated provider calls before GitHub
 * starts refusing us outright.
 */
export const previewQuotaLimiter = rateLimit({
    windowMs: HOUR,
    limit: 50,
    keyGenerator: () => "preview-quota",
    standardHeaders: false,
    legacyHeaders: false,
    message: tooManyRequests(
        "Repository preview is temporarily unavailable due to provider rate limits. Please try again later."
    )
});

/**
 * Starting an OAuth flow writes to the database (creates a PENDING row and
 * may revoke a stale one), so it's more expensive than a read and worth
 * limiting per user rather than per IP.
 */
export const authorizeLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 10,
    keyGenerator: userOrIpKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooManyRequests("Too many authorization attempts. Please wait a moment and try again.")
});

/**
 * The OAuth callback is hit by the user's own browser, so IP is a real
 * identity here.
 *
 * A legitimate user triggers this once per connection, so 20/minute is far
 * above normal use while still bounding automated attempts against the CSRF
 * nonce (each of which takes a row lock — see
 * IntegrationRepository.consumeOAuthNonce). The nonce itself is what makes
 * those attempts futile; this just stops them costing us database work.
 */
export const oauthCallbackLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 20,
    keyGenerator: ipKey,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooManyRequests("Too many callback attempts. Please restart the authorization flow.")
});
