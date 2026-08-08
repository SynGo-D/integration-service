// src/models/Integration.ts

/**
 * Domain model for a single-repository integration.
 *
 * Lifecycle: PENDING → ACTIVE (after OAuth)
 *            ACTIVE  → EXPIRED | REVOKED
 */
export interface Integration {

    id: string;

    /** Platform user who owns this integration. */
    userId: string;

    /** Source control provider. */
    provider: "github" | "gitlab";

    /** Canonical URL of the connected repository. */
    repositoryUrl: string;

    /** Owner login or namespace (e.g. "facebook" or "gitlab-org"). */
    repositoryOwner: string;

    /** Repository slug (e.g. "react"). */
    repositoryName: string;

    /**
     * Encrypted access token stored at rest.
     * The service layer decrypts it before using it.
     */
    accessToken: string;

    /** Optional refresh token (provider-dependent). */
    refreshToken?: string;

    /** When the access token expires; NULL means it does not expire. */
    tokenExpiresAt?: Date;

    /** Provider-side user identifier; set after OAuth completes. */
    providerUserId?: string;

    /** Provider-side username/login; set after OAuth completes. */
    providerUsername?: string;

    /** Lifecycle status. */
    status: "PENDING" | "ACTIVE" | "EXPIRED" | "REVOKED";

    createdAt: Date;

    updatedAt: Date;
}
