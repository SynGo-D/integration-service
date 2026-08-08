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
}
