// src/services/IntegrationService.ts

import { randomBytes } from "crypto";
import { ProviderFactory } from "../factories/ProviderFactory.js";
import { ProviderAdapter } from "../adapters/ProviderAdapter.js";
import { IntegrationRepository, ConsumeNonceResult } from "../repositories/IntegrationRepository.js";
import { Integration } from "../models/Integration.js";
import { RepositoryPreview } from "../types/RepositoryPreview.js";
import { OAuthState } from "../types/OAuthState.js";
import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { OrganizationService } from "./OrganizationService.js";
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
 *   • CSRF protection: the OAuth state carries a one-time nonce that is
 *     stored on the PENDING row and verified + consumed on callback (see
 *     IntegrationRepository.consumeOAuthNonce).
 */

/**
 * How long an OAuth authorization may stay open. The user is redirected to
 * the provider, approves, and comes straight back — this is seconds of real
 * interaction, so ten minutes is already generous, and it bounds how long a
 * stolen/abandoned state parameter stays usable.
 */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Refresh this long before a token actually expires. Without a margin, a
 * token judged valid at the start of a request can expire while the
 * provider call is still in flight, producing a 401 that looks like a
 * revoked integration.
 */
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/**
 * The slice of ProviderFactory this service depends on. Declared as an
 * interface so tests can substitute a stub adapter — the concrete factory
 * builds real adapters that would reach GitHub over the network.
 */
export interface ProviderAdapterFactory {
    create(provider: string): ProviderAdapter;
}

export class IntegrationService {

    private readonly integrationRepository: IntegrationRepository;
    private readonly providerFactory: ProviderAdapterFactory;
    private readonly organizationService: OrganizationService;

    constructor(
        integrationRepository?: IntegrationRepository,
        providerFactory?: ProviderAdapterFactory,
        organizationService?: OrganizationService
    ) {
        this.integrationRepository =
            integrationRepository ?? new IntegrationRepository();
        this.providerFactory = providerFactory ?? ProviderFactory;
        this.organizationService = organizationService ?? new OrganizationService();
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
        const adapter = this.providerFactory.create(parsed.provider);

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
        userId:         string,
        repositoryUrl:  string,
        organizationId: string,
        projectId:      string | null = null
    ): Promise<{ integrationId: string; authorizationUrl: string }> {

        // Validate inputs
        if (!userId || typeof userId !== "string") {
            throw new ValidationError("userId is required.");
        }
        if (!repositoryUrl || typeof repositoryUrl !== "string") {
            throw new ValidationError("repositoryUrl is required.");
        }
        if (!organizationId || typeof organizationId !== "string") {
            throw new ValidationError("organizationId is required.");
        }

        // A repository belongs to the organization, so connecting one is a
        // manager's job, and the project it is filed under must be the
        // organization's own.
        await this.organizationService.requireRole(organizationId, userId, "MANAGER");
        if (projectId) {
            await this.organizationService.assertProjectInOrganization(organizationId, projectId);
        }

        // Parse URL → detect provider + extract owner/name
        const parsed = RepositoryUrlParser.parse(repositoryUrl);

        // Prevent duplicate connections for the same repository. The unique
        // index (idx_integrations_user_repo_unique) blocks any non-REVOKED
        // row, so PENDING/EXPIRED rows must be handled here too, not just
        // ACTIVE ones — otherwise a re-authorize attempt after an abandoned
        // OAuth flow would hit a raw DB constraint violation.
        // Organization-wide, not per user: two members connecting the same
        // repository would mean two webhooks and two analyses of every PR.
        const connected = await this.integrationRepository.findActiveInOrganization(
            organizationId,
            parsed.provider,
            parsed.owner,
            parsed.repository
        );

        if (connected) {
            throw new AppError(
                `${parsed.owner}/${parsed.repository} is already connected to this organization.`,
                409
            );
        }

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

        // Normalise the URL (strip trailing slashes, then the .git suffix).
        // Delegated to the parser rather than repeated here: this used to be
        // its own copy of the same two replaces in the wrong order, which
        // stored "…/shop.git" as the canonical URL for any input ending in
        // ".git/".
        const normalizedUrl = RepositoryUrlParser.normalize(repositoryUrl);

        // The CSRF nonce: 16 random bytes, stored on the row below and
        // required (and destroyed) by the callback. Generated here rather
        // than in the repository so the same value can go into both the
        // database and the state parameter.
        const nonce = randomBytes(16).toString("hex");

        // Create the PENDING row before redirecting — this allows us to
        // correlate the OAuth callback with the correct repository, and is
        // where the nonce lives until the callback consumes it.
        const integration = await this.integrationRepository.createPending(
            userId,
            parsed.provider,
            normalizedUrl,
            parsed.owner,
            parsed.repository,
            nonce,
            new Date(Date.now() + OAUTH_STATE_TTL_MS),
            organizationId,
            projectId
        );

        // Build the OAuth state: integrationId + provider + CSRF nonce
        const oauthState: OAuthState = {
            integrationId: integration.id,
            provider:      parsed.provider,
            nonce
        };

        const encodedState = Buffer
            .from(JSON.stringify(oauthState), "utf8")
            .toString("base64url");

        // Delegate URL construction to the provider-specific adapter
        const adapter          = this.providerFactory.create(parsed.provider);
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

        // CSRF gate. Verifies the nonce against the one stored when this
        // flow started and consumes it in the same transaction, so a
        // forged state, a replayed callback, or an expired session all
        // stop here — before any authorization code is exchanged.
        //
        // This also subsumes the existence/status checks that used to live
        // here: it's a single locked read rather than a separate read that
        // another request could invalidate before the write.
        const consumed = await this.integrationRepository.consumeOAuthNonce(
            oauthState.integrationId,
            oauthState.nonce
        );

        if (consumed !== "consumed") {
            throw this.oauthStateError(consumed);
        }

        // Use the provider from the state (avoids an extra DB read just to get the provider)
        const adapter = this.providerFactory.create(oauthState.provider);

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
     * newly-connected repository, signed with a secret unique to this
     * integration, and records its ID.
     *
     * The per-integration secret replaces a single shared secret per
     * provider. With one shared secret, leaking it let anyone forge a
     * delivery for every connected repository; now a leak is contained to
     * one. webhook-listener fetches it through the internal lookup endpoint
     * (routes/InternalRoutes.ts) to verify each delivery.
     */
    private async registerWebhook(
        adapter: ProviderAdapter,
        integration: Integration,
        accessToken: string,
        provider: "github" | "gitlab"
    ): Promise<void> {
        const secret = randomBytes(32).toString("hex");

        try {
            // Stored before the hook exists — see setWebhookSecret for why.
            await this.integrationRepository.setWebhookSecret(integration.id, secret);

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

    /**
     * Whether this user may see a repository's analyses, reviews, rules
     * and contributors.
     *
     * Access follows organization membership and nothing else: an admin
     * creates an organization, connects repositories to it, and adds
     * people by email. Being signed in is not access — that is the
     * distinction the repository routes were missing.
     */
    async userCanAccessRepository(
        userId: string,
        provider: "github" | "gitlab",
        repositoryOwner: string,
        repositoryName: string
    ): Promise<boolean> {
        if (!userId || !repositoryOwner || !repositoryName) {
            return false;
        }

        return this.integrationRepository.userCanAccessRepository(
            userId, provider, repositoryOwner, repositoryName
        );
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
     * An organization's connected repositories, optionally narrowed to one
     * project. Any member may read them; the membership check is what
     * keeps one tenant out of another's list.
     */
    async getOrganizationIntegrations(
        organizationId: string,
        userId:         string,
        projectId?:     string | null
    ): Promise<Integration[]> {
        await this.organizationService.requireMember(organizationId, userId);
        return this.integrationRepository.findByOrganization(organizationId, projectId ?? null);
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
                const adapter = this.providerFactory.create(integration.provider);
                // Refresh first if needed: an integration being revoked is
                // often one that's been connected a long time, which is
                // exactly when a stored token has gone stale.
                const accessToken = await this.getValidAccessToken(integration);
                await adapter.unregisterWebhook(
                    accessToken,
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
    // Webhook verification support (called by webhook-listener)
    // -----------------------------------------------------------------------

    /**
     * The secrets a delivery for `repositoryFullName` may be signed with.
     *
     * An empty `secrets` list with `legacy: false` means the repository has
     * no active integration — webhook-listener rejects the delivery, which
     * is what makes this lookup an allowlist as well as a key store.
     *
     * `legacy: true` means at least one active integration predates
     * per-integration secrets; only then may webhook-listener fall back to
     * the old shared secret. That fallback is scoped to repositories that
     * genuinely need it, so a leaked shared secret can't be used against a
     * repository connected after this change.
     *
     * GitLab full names can contain nested groups (`group/sub/repo`), so the
     * split is on the *last* slash, matching RepositoryUrlParser.
     */
    async getWebhookSecrets(
        provider:           string,
        repositoryFullName: string
    ): Promise<{ secrets: string[]; legacy: boolean }> {
        const { owner, name } = parseRepository(provider, repositoryFullName);

        const stored = await this.integrationRepository.findActiveWebhookSecrets(
            provider as "github" | "gitlab", owner, name
        );

        return {
            secrets: stored.filter((s): s is string => s !== null),
            legacy:  stored.some((s) => s === null)
        };
    }

    /**
     * A currently valid access token for cloning a connected repository,
     * for analysis-engine (internal route only). Returns null when nobody
     * has an active integration for it: the caller then clones anonymously,
     * which works for public repositories.
     *
     * Several users may have connected the same repository; each is tried
     * in turn, so one user's revoked access doesn't block analysis while
     * another user's integration still works.
     */
    async getRepositoryAccessToken(
        provider:           string,
        repositoryFullName: string
    ): Promise<{ token: string; expiresAt: string | null } | null> {
        const { owner, name } = parseRepository(provider, repositoryFullName);
        const integrations = await this.integrationRepository.findActiveByRepository(
            provider as "github" | "gitlab", owner, name
        );

        for (const integration of integrations) {
            try {
                const token = await this.getValidAccessToken(integration);
                const expiresAt = integration.tokenExpiresAt && token === integration.accessToken
                    ? integration.tokenExpiresAt.toISOString()
                    : null;
                return { token, expiresAt };
            } catch (error) {
                if (!(error instanceof AppError)) {
                    throw error;
                }
                // Expired or unrenewable: already marked EXPIRED; try the next one.
            }
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Token lifecycle
    // -----------------------------------------------------------------------

    /**
     * Returns an access token that is valid *now*, refreshing it first if
     * it has expired or is about to.
     *
     * Every provider call made with a stored token should go through here
     * rather than reading `integration.accessToken` directly. GitHub OAuth
     * App tokens don't expire by default, which makes the stale-token path
     * invisible in development and then breaks GitLab, whose tokens last
     * two hours.
     *
     * On an unrecoverable failure the integration is marked EXPIRED before
     * throwing, so the UI can prompt the user to reconnect instead of the
     * connection silently appearing healthy while every provider call 401s.
     */
    async getValidAccessToken(integration: Integration): Promise<string> {
        // No expiry recorded means the provider issues non-expiring tokens
        // (classic GitHub OAuth Apps). Nothing to refresh.
        if (!integration.tokenExpiresAt) {
            return integration.accessToken;
        }

        const expiresInMs = integration.tokenExpiresAt.getTime() - Date.now();
        if (expiresInMs > TOKEN_REFRESH_MARGIN_MS) {
            return integration.accessToken;
        }

        if (!integration.refreshToken) {
            // Expired with no way to renew — the user must reconnect.
            await this.markExpired(integration.id);
            throw new AppError(
                "This integration's access has expired. Please reconnect the repository.",
                401
            );
        }

        try {
            const adapter = this.providerFactory.create(integration.provider);
            const refreshed = await adapter.refreshAccessToken(integration.refreshToken);

            await this.integrationRepository.updateTokens(
                integration.id,
                refreshed.accessToken,
                refreshed.refreshToken,
                refreshed.expiresAt ? new Date(refreshed.expiresAt) : undefined
            );

            return refreshed.accessToken;

        } catch (err) {
            // A refresh token can be revoked by the user, expire outright,
            // or already have been consumed — none of which this call can
            // recover from.
            console.error(
                `Token refresh failed for integration ${integration.id}:`,
                err instanceof Error ? err.message : err
            );
            await this.markExpired(integration.id);
            throw new AppError(
                "Could not renew access to this repository. Please reconnect it.",
                401
            );
        }
    }

    /** Best-effort status flip — never masks the original token failure. */
    private async markExpired(id: string): Promise<void> {
        try {
            await this.integrationRepository.updateStatus(id, "EXPIRED");
        } catch (err) {
            console.error(
                `Failed to mark integration ${id} as EXPIRED:`,
                err instanceof Error ? err.message : err
            );
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Maps a failed nonce consumption to an HTTP error.
     *
     * `invalid` covers a wrong nonce, an expired session, and a replayed
     * callback alike — they're deliberately indistinguishable to the
     * caller, so probing the endpoint reveals nothing. `not_found` and
     * `not_pending` stay distinct because they aid legitimate debugging
     * and disclose nothing an attacker couldn't already infer: the
     * integration ID came from their own browser's URL.
     */
    private oauthStateError(result: ConsumeNonceResult): AppError {
        switch (result) {
            case "not_found":
                return new AppError(
                    "Integration not found. The authorization session may have expired.",
                    404
                );
            case "not_pending":
                return new AppError(
                    "This authorization has already been completed or revoked.",
                    409
                );
            default:
                return new AppError(
                    "Invalid or expired authorization session. Please start again.",
                    400
                );
        }
    }

    /**
     * Decodes and validates the base64url-encoded OAuth state parameter.
     * Throws a 400 error if the state is malformed or missing required fields.
     *
     * Note this only checks *shape* — the state is unsigned base64url, so
     * anyone can produce a well-formed one. Authenticity comes entirely
     * from the nonce check in consumeOAuthNonce.
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

/**
 * Validates a provider name and splits "owner/name". GitLab full names can
 * contain nested groups (`group/sub/repo`), so the split is on the *last*
 * slash, matching RepositoryUrlParser.
 */
function parseRepository(provider: string, repositoryFullName: string): { owner: string; name: string } {
    if (provider !== "github" && provider !== "gitlab") {
        throw new ValidationError("provider must be 'github' or 'gitlab'.");
    }
    const slash = repositoryFullName.lastIndexOf("/");
    if (slash <= 0 || slash === repositoryFullName.length - 1) {
        throw new ValidationError("repository must be in 'owner/name' form.");
    }
    return { owner: repositoryFullName.slice(0, slash), name: repositoryFullName.slice(slash + 1) };
}
