// src/adapters/ProviderAdapter.ts

import { RepositoryPreview } from "../types/RepositoryPreview.js";

// ---------------------------------------------------------------------------
// Shared data shapes exchanged between the adapter and the service layer.
// All adapters must map provider-specific API responses onto these types.
// ---------------------------------------------------------------------------

export interface ProviderCredentials {
    token: string;
}

export interface ProviderUser {
    id: string;
    username: string;
    email?: string;
    provider: "github" | "gitlab";
}

export interface ProviderOrganization {
    id: string;
    externalId: string;
    name: string;
    provider: "github" | "gitlab";
}

export interface ProviderRepository {
    id: string;
    externalId: string;
    name: string;
    fullName: string;
    cloneUrl?: string;
    defaultBranch?: string;
    language?: string;
    visibility?: string;
    lastUpdated?: string;
    organizationExternalId?: string;
}

/** Result returned after successfully exchanging an authorization code. */
export interface OAuthTokenResult {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    providerUser: ProviderUser;
}

/**
 * Result of exchanging a refresh token for a fresh access token.
 *
 * Narrower than OAuthTokenResult on purpose: a refresh re-establishes
 * credentials for an identity that's already known and stored, so making
 * adapters re-fetch the provider user would be a wasted API call on a path
 * that may run often.
 *
 * `refreshToken` is optional but usually present — both GitHub and GitLab
 * rotate it, issuing a new one alongside each access token and invalidating
 * the old. Callers must persist whatever comes back, or the *next* refresh
 * will fail with an already-used token.
 */
export interface RefreshedToken {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Core adapter contract — every supported provider must implement this.
// ---------------------------------------------------------------------------

export interface ProviderAdapter {

    // -- Authenticated operations (require a valid access token) ------------

    authenticate(credentials: ProviderCredentials): Promise<ProviderUser>;

    getUser(token: string): Promise<ProviderUser>;

    getOrganizations(token: string): Promise<ProviderOrganization[]>;

    getRepositories(
        token: string,
        organizationExternalId: string
    ): Promise<ProviderRepository[]>;

    getRepositoryDetails(
        token: string,
        repositoryExternalId: string
    ): Promise<ProviderRepository>;

    // -- Unauthenticated operations (public data) ----------------------------

    /**
     * Fetches publicly available repository metadata without authentication.
     * Used to populate the preview panel before the user authorizes.
     */
    getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview>;

    // -- OAuth flow ----------------------------------------------------------

    /**
     * Builds the provider authorization URL that the user is redirected to.
     *
     * @param state - Opaque string forwarded by the provider on callback.
     *                Used to carry context (integrationId, nonce) through
     *                the browser redirect.
     */
    generateAuthorizationUrl(state: string): string;

    /**
     * Exchanges the authorization code received on callback for access tokens.
     * Also fetches the provider user profile so we can store it alongside the
     * integration record.
     */
    exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult>;

    /**
     * Exchanges a stored refresh token for a fresh access token.
     *
     * Only reached for integrations whose token actually carries an expiry
     * (see IntegrationService.getValidAccessToken) — GitHub OAuth App tokens
     * don't expire by default, so in practice this is GitLab's path, where
     * tokens last two hours.
     *
     * Throws on any provider rejection. A refresh token can be revoked by
     * the user, expired outright, or already consumed by a previous refresh,
     * and none of those are recoverable here — the caller marks the
     * integration EXPIRED and the user reconnects.
     */
    refreshAccessToken(refreshToken: string): Promise<RefreshedToken>;

    // -- Webhook registration --------------------------------------------

    /**
     * Registers a webhook on the provider so pull/merge-request events for
     * this repository are delivered to `callbackUrl` (webhook-listener).
     * Called immediately after OAuth completes — see
     * IntegrationService.handleOAuthCallback.
     *
     * `secret` is used to sign (GitHub, HMAC) or authenticate (GitLab, a
     * plain shared token) deliveries; it must be the same value
     * webhook-listener verifies incoming requests against.
     */
    registerWebhook(
        token: string,
        owner: string,
        repo: string,
        callbackUrl: string,
        secret: string
    ): Promise<{ providerWebhookId: string }>;

    /**
     * Removes a previously-registered webhook. Called when an integration is
     * revoked, so a disconnected repository stops sending events.
     */
    unregisterWebhook(
        token: string,
        owner: string,
        repo: string,
        providerWebhookId: string
    ): Promise<void>;
}
