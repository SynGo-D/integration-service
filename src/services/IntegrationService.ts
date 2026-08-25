// src/services/IntegrationService.ts

import { randomBytes } from "crypto";
import { ProviderFactory } from "../factories/ProviderFactory.js";
import { ProviderAdapter } from "../adapters/ProviderAdapter.js";
import { IntegrationRepository } from "../repositories/IntegrationRepository.js";
import { Integration } from "../models/Integration.js";
import { RepositoryPreview } from "../types/RepositoryPreview.js";
import { OAuthState } from "../types/OAuthState.js";
import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { RepositoryUrlParser } from "../utils/RepositoryUrlParser.js";
import { env } from "../config/env.js";

/**
 * Core business logic for the Integration Service – Phase 1.
 *
 * This service is the single source of truth for:
 *
 *   1. Public metadata preview  — unauthenticated fetch via adapter
 *   2. OAuth initiation         — create PENDING row, build provider auth URL
 *   3. OAuth callback handling  — exchange code, encrypt tokens, activate row
 *   4. Integration queries      — list / get by ID
 *
 * Design principles applied:
 *   • Provider-agnostic: all provider-specific behaviour lives in adapters.
 *   • Single-repo focus: no organisation sync; connects one repository at a time.
 *   • Least privilege: adapters request minimum OAuth scopes.
 *   • Duplicate prevention: won't create a second ACTIVE connection to the
 *     same repo for the same user.
 *   • CSRF protection: OAuth state includes a one-time nonce.
 */
export class IntegrationService {

    private readonly integrationRepository: IntegrationRepository;

    constructor(integrationRepository?: IntegrationRepository) {
        this.integrationRepository =
            integrationRepository ?? new IntegrationRepository();
    }

    // -----------------------------------------------------------------------
    // Step 1: Preview — fetch public metadata without authentication
    // -----------------------------------------------------------------------

    /**
     * Fetches publicly available metadata for a repository URL.
     * No token required; the adapter calls the provider's public API.
     *
     * Called when the user enters a URL in the UI and clicks "Preview".
     */
    async getRepositoryPreview(url: string): Promise<RepositoryPreview> {
        if (!url || typeof url !== "string") {
            throw new ValidationError("Repository URL is required.");
        }

        const parsed  = RepositoryUrlParser.parse(url);
        const adapter = ProviderFactory.create(parsed.provider);

        return adapter.getPublicRepositoryMetadata(url);
    }

    // -----------------------------------------------------------------------
    // Step 2: Authorize — create PENDING integration, return OAuth URL
    // -----------------------------------------------------------------------

    /**
     * Creates a PENDING integration record and returns the OAuth authorization
     * URL the frontend should redirect the user to.
     *
     * Called when the user confirms the repository preview and clicks "Authorize".
     *
     * @returns An object containing the integration ID and the redirect URL.
     */
    async initiateOAuth(
        userId:        string,
        repositoryUrl: string
    ): Promise<{ integrationId: string; authorizationUrl: string }> {

        // Validate inputs
        if (!userId || typeof userId !== "string") {
            throw new ValidationError("userId is required.");
        }
        if (!repositoryUrl || typeof repositoryUrl !== "string") {
            throw new ValidationError("repositoryUrl is required.");
        }

        // Parse URL → detect provider + extract owner/name
        const parsed = RepositoryUrlParser.parse(repositoryUrl);

        // Prevent duplicate connections for the same repository. The unique
        // index (idx_integrations_user_repo_unique) blocks any non-REVOKED
        // row, so PENDING/EXPIRED rows must be handled here too, not just
        // ACTIVE ones — otherwise a re-authorize attempt after an abandoned
        // OAuth flow would hit a raw DB constraint violation.
        const existing = await this.integrationRepository.findConnectionByUserAndRepo(
            userId,
            parsed.provider,
            parsed.owner,
            parsed.repository
        );

        if (existing) {
            if (existing.status === "ACTIVE") {
                throw new AppError(
                    `You already have an active integration for ${parsed.owner}/${parsed.repository}.`,
                    409
                );
            }

            // Stale PENDING (abandoned mid-flow) or EXPIRED — revoke it so a
            // fresh attempt can proceed without violating the unique index.
            await this.integrationRepository.updateStatus(existing.id, "REVOKED");
        }

        // Normalise the URL (strip .git suffix, trailing slash)
        const normalizedUrl = repositoryUrl
            .trim()
            .replace(/\.git$/u, "")
            .replace(/\/+$/u, "");

        // Create the PENDING row before redirecting — this allows us to
        // correlate the OAuth callback with the correct repository.
        const integration = await this.integrationRepository.createPending(
            userId,
            parsed.provider,
            normalizedUrl,
            parsed.owner,
            parsed.repository
        );

        // Build the OAuth state: integrationId + provider + CSRF nonce
        const oauthState: OAuthState = {
            integrationId: integration.id,
            provider:      parsed.provider,
            nonce:         randomBytes(16).toString("hex")
        };

        const encodedState = Buffer
            .from(JSON.stringify(oauthState), "utf8")
            .toString("base64url");

        // Delegate URL construction to the provider-specific adapter
        const adapter          = ProviderFactory.create(parsed.provider);
        const authorizationUrl = adapter.generateAuthorizationUrl(encodedState);

        return { integrationId: integration.id, authorizationUrl };
    }

    // -----------------------------------------------------------------------
    // Step 3: OAuth callback — exchange code, activate integration
    // -----------------------------------------------------------------------

    /**
     * Handles the OAuth callback from the provider.
     *
     * The provider is determined from the decoded `state` (source of truth,
     * since state is CSRF-protected), and cross-checked against `routeProvider`
     * (the `:provider` URL segment) to catch a route/provider mismatch early.
     *
     * @returns The fully activated integration.
     */
    async handleOAuthCallback(
        code:          string,
        state:         string,
        routeProvider: string
    ): Promise<Integration> {

        if (!code || typeof code !== "string") {
            throw new ValidationError("Authorization code is required.");
        }

        const oauthState = this.decodeOAuthState(state);

        if (oauthState.provider !== routeProvider) {
            throw new AppError(
                `Callback provider '${routeProvider}' does not match the authorization request.`,
                400
            );
        }

        // Load the pending integration to validate it exists
        const pendingIntegration = await this.integrationRepository.findById(
            oauthState.integrationId
        );

        if (!pendingIntegration) {
            throw new AppError(
                "Integration not found. The authorization session may have expired.",
                404
            );
        }

        if (pendingIntegration.status !== "PENDING") {
            throw new AppError(
                `Integration is already in '${pendingIntegration.status}' status.`,
                409
            );
        }

        // Use the provider from the state (avoids an extra DB read just to get the provider)
        const adapter = ProviderFactory.create(oauthState.provider);

        // Exchange the authorization code for access tokens
        const tokenResult = await adapter.exchangeAuthorizationCode(code);

        // Activate the integration with encrypted tokens
        const activeIntegration = await this.integrationRepository.activateIntegration(
            oauthState.integrationId,
            tokenResult.accessToken,
            tokenResult.refreshToken,
            tokenResult.expiresAt ? new Date(tokenResult.expiresAt) : undefined,
            tokenResult.providerUser.id,
            tokenResult.providerUser.username
        );

        // Best-effort webhook registration: a repository is considered
        // successfully connected once OAuth completes, regardless of
        // whether hook creation also succeeds — a transient GitHub/GitLab
        // API failure here shouldn't undo an otherwise-successful
        // authorization. Failures are logged, not thrown.
        await this.registerWebhook(adapter, activeIntegration, tokenResult.accessToken, oauthState.provider);

        return activeIntegration;
    }

    /**
     * Creates a provider-side webhook pointed at webhook-listener for the
     * newly-connected repository, and records its ID. Skips silently (with
     * a warning) if no shared secret is configured for the provider —
     * matches this repo's existing pattern of leaving unconfigured
     * providers (e.g. GitLab OAuth credentials) as inert placeholders
     * rather than throwing at startup.
     */
    private async registerWebhook(
        adapter: ProviderAdapter,
        integration: Integration,
        accessToken: string,
        provider: "github" | "gitlab"
    ): Promise<void> {
        const secret = provider === "github" ? env.GITHUB_WEBHOOK_SECRET : env.GITLAB_WEBHOOK_SECRET;

        if (!secret) {
            console.warn(
                `Skipping webhook registration for integration ${integration.id}: ` +
                `no webhook secret configured for provider '${provider}'.`
            );
            return;
        }

        try {
            const callbackUrl = `${env.WEBHOOK_LISTENER_URL}/webhooks/${provider}`;
            const { providerWebhookId } = await adapter.registerWebhook(
                accessToken,
                integration.repositoryOwner,
                integration.repositoryName,
                callbackUrl,
                secret
            );
            await this.integrationRepository.setWebhookId(integration.id, providerWebhookId);
        } catch (err) {
            console.error(
                `Webhook registration failed for integration ${integration.id} ` +
                `(${integration.repositoryOwner}/${integration.repositoryName}):`,
                err instanceof Error ? err.message : err
            );
        }
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /**
     * Returns all integrations for a user, most-recent first.
     * Access tokens are stripped before returning to the controller layer.
     */
    async getIntegrations(userId: string): Promise<Integration[]> {
        if (!userId) {
            throw new ValidationError("userId is required.");
        }
        return this.integrationRepository.findByUser(userId);
    }

    /**
     * Returns a single integration by ID.
     */
    async getIntegrationById(id: string): Promise<Integration> {
        const integration = await this.integrationRepository.findById(id);
        if (!integration) {
            throw new AppError("Integration not found.", 404);
        }
        return integration;
    }

    /**
     * Revokes (soft-deletes) an integration so the user can reconnect later.
     * Also removes the provider-side webhook, if one was registered — best
     * effort, same reasoning as registration: a revoke shouldn't get stuck
     * because the provider's hook-deletion API had a hiccup.
     */
    async revokeIntegration(id: string): Promise<void> {
        const integration = await this.integrationRepository.findById(id);
        if (!integration) {
            throw new AppError("Integration not found.", 404);
        }

        if (integration.providerWebhookId) {
            try {
                const adapter = ProviderFactory.create(integration.provider);
                await adapter.unregisterWebhook(
                    integration.accessToken,
                    integration.repositoryOwner,
                    integration.repositoryName,
                    integration.providerWebhookId
                );
            } catch (err) {
                console.error(
                    `Webhook removal failed for integration ${integration.id}:`,
                    err instanceof Error ? err.message : err
                );
            }
        }

        await this.integrationRepository.updateStatus(id, "REVOKED");
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Decodes and validates the base64url-encoded OAuth state parameter.
     * Throws a 400 error if the state is malformed or missing required fields.
     */
    private decodeOAuthState(state: string): OAuthState {
        if (!state || typeof state !== "string") {
            throw new ValidationError("Missing OAuth state parameter.");
        }

        try {
            const json   = Buffer.from(state, "base64url").toString("utf8");
            const parsed = JSON.parse(json) as OAuthState;

            if (
                !parsed.integrationId ||
                !parsed.provider      ||
                !parsed.nonce
            ) {
                throw new Error("Incomplete state payload.");
            }

            return parsed;
        } catch {
            throw new AppError("Invalid or tampered OAuth state.", 400);
        }
    }
}
