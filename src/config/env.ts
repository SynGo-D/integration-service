// src/config/env.ts

import "dotenv/config";

/**
 * Centralised, type-safe access to all environment variables.
 *
 * Every variable should be read from process.env exactly once here.
 * The rest of the application should import `env` rather than
 * accessing process.env directly.
 */
export const env = {

    // -----------------------------------------------------------------------
    // Server
    // -----------------------------------------------------------------------

    PORT: Number(process.env.PORT) || 5001,

    // -----------------------------------------------------------------------
    // Database
    // -----------------------------------------------------------------------

    DB_HOST:     process.env.DB_HOST!,
    DB_PORT:     Number(process.env.DB_PORT) || 5432,
    DB_NAME:     process.env.DB_NAME!,
    DB_USER:     process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,

    // -----------------------------------------------------------------------
    // Token encryption (AES-256-GCM)
    // Generate a 32-byte hex key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    // -----------------------------------------------------------------------

    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",

    // -----------------------------------------------------------------------
    // GitHub OAuth
    // Register at: https://github.com/settings/developers
    // -----------------------------------------------------------------------

    GITHUB_CLIENT_ID:     process.env.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? "",
    GITHUB_CALLBACK_URL:  process.env.GITHUB_CALLBACK_URL ?? "http://localhost:5001/api/integrations/github/oauth/callback",

    // -----------------------------------------------------------------------
    // GitLab OAuth
    // Register at: https://gitlab.com/-/profile/applications
    // -----------------------------------------------------------------------

    GITLAB_CLIENT_ID:     process.env.GITLAB_CLIENT_ID ?? "",
    GITLAB_CLIENT_SECRET: process.env.GITLAB_CLIENT_SECRET ?? "",
    GITLAB_CALLBACK_URL:  process.env.GITLAB_CALLBACK_URL ?? "http://localhost:5001/api/integrations/gitlab/oauth/callback",

    // -----------------------------------------------------------------------
    // Frontend
    // Where the user is redirected after a successful OAuth completion.
    // -----------------------------------------------------------------------

    FRONTEND_SUCCESS_URL: process.env.FRONTEND_SUCCESS_URL ?? "http://localhost:3000/integrations",
    FRONTEND_ERROR_URL:   process.env.FRONTEND_ERROR_URL   ?? "http://localhost:3000/integrations/error",

    // -----------------------------------------------------------------------
    // Webhook auto-registration
    // Base URL of the webhook-listener service that GitHub/GitLab should
    // deliver events to. Must be publicly reachable from the provider's
    // servers — localhost only works for provider sandboxes/local replay,
    // not real deliveries; point this at a tunnel or public domain in front
    // of webhook-listener for real webhook delivery.
    //
    // The two secrets MUST be the exact same values webhook-listener's own
    // .env uses (GITHUB_WEBHOOK_SECRET / GITLAB_WEBHOOK_SECRET) — this
    // service sets them when creating the hook, webhook-listener verifies
    // deliveries against them; if they diverge, every delivery fails
    // signature verification.
    // -----------------------------------------------------------------------

    WEBHOOK_LISTENER_URL: process.env.WEBHOOK_LISTENER_URL ?? "http://localhost:5002",
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? "",
};