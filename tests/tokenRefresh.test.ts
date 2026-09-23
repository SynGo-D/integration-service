import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { IntegrationService, ProviderAdapterFactory } from "../src/services/IntegrationService.js";
import { Integration } from "../src/models/Integration.js";
import { ProviderAdapter, RefreshedToken } from "../src/adapters/ProviderAdapter.js";

/**
 * Token refresh is the hardest path in this service to verify by hand: it
 * only fires once a stored token has actually aged out, which for GitLab is
 * two hours after a real connection and for GitHub may be never. These
 * tests drive it directly with controlled clocks and a stub provider.
 */

const HOUR = 60 * 60 * 1000;

function integrationWith(overrides: Partial<Integration> = {}): Integration {
    return {
        id: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        provider: "gitlab",
        repositoryUrl: "https://gitlab.com/acme/shop",
        repositoryOwner: "acme",
        repositoryName: "shop",
        accessToken: "current-access-token",
        refreshToken: "current-refresh-token",
        tokenExpiresAt: new Date(Date.now() + HOUR),
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    } as Integration;
}

/** Minimal stubs — only the members getValidAccessToken actually touches. */
function makeHarness(refresh?: () => Promise<RefreshedToken>) {
    const adapter = {
        refreshAccessToken: vi.fn(
            refresh ?? (async () => ({
                accessToken: "new-access-token",
                refreshToken: "new-refresh-token",
                expiresAt: new Date(Date.now() + 2 * HOUR).toISOString()
            }))
        )
    } as unknown as ProviderAdapter;

    const factory: ProviderAdapterFactory = { create: vi.fn(() => adapter) };

    const repository = {
        updateTokens: vi.fn(async () => integrationWith()),
        updateStatus: vi.fn(async () => integrationWith({ status: "EXPIRED" }))
    };

    const service = new IntegrationService(repository as never, factory);
    return { service, adapter, repository, factory };
}

describe("IntegrationService.getValidAccessToken", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns the stored token unchanged when no expiry is recorded", async () => {
        // Classic GitHub OAuth App tokens never expire — refreshing them
        // would be a pointless round trip on every call.
        const { service, adapter } = makeHarness();
        const integration = integrationWith({
            provider: "github", tokenExpiresAt: undefined, accessToken: "gho_permanent"
        });

        expect(await service.getValidAccessToken(integration)).toBe("gho_permanent");
        expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("returns the stored token when it is still comfortably valid", async () => {
        const { service, adapter } = makeHarness();
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() + HOUR) });

        expect(await service.getValidAccessToken(integration)).toBe("current-access-token");
        expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("refreshes a token that has already expired", async () => {
        const { service, adapter } = makeHarness();
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() - HOUR) });

        expect(await service.getValidAccessToken(integration)).toBe("new-access-token");
        expect(adapter.refreshAccessToken).toHaveBeenCalledWith("current-refresh-token");
    });

    it("refreshes a token that is about to expire, before it fails mid-request", async () => {
        // 30s left is inside the 60s margin: valid right now, but not
        // necessarily still valid by the time the provider call lands.
        const { service, adapter } = makeHarness();
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() + 30_000) });

        expect(await service.getValidAccessToken(integration)).toBe("new-access-token");
        expect(adapter.refreshAccessToken).toHaveBeenCalledOnce();
    });

    it("persists the rotated refresh token, not just the access token", async () => {
        // GitLab invalidates the refresh token it just consumed. Keeping the
        // old one would work now and break the *next* refresh.
        const { service, repository } = makeHarness();
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() - 1000) });

        await service.getValidAccessToken(integration);

        expect(repository.updateTokens).toHaveBeenCalledOnce();
        const [id, accessToken, refreshToken, expiresAt] = repository.updateTokens.mock.calls[0];
        expect(id).toBe(integration.id);
        expect(accessToken).toBe("new-access-token");
        expect(refreshToken).toBe("new-refresh-token");
        expect(expiresAt).toBeInstanceOf(Date);
    });

    it("marks the integration EXPIRED when it has expired with no refresh token", async () => {
        const { service, repository, adapter } = makeHarness();
        const integration = integrationWith({
            tokenExpiresAt: new Date(Date.now() - HOUR), refreshToken: undefined
        });

        await expect(service.getValidAccessToken(integration)).rejects.toThrow(/expired/i);
        expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
        expect(repository.updateStatus).toHaveBeenCalledWith(integration.id, "EXPIRED");
    });

    it("marks the integration EXPIRED when the provider rejects the refresh", async () => {
        // A user can revoke the grant at the provider at any time; the
        // refresh token is then dead and no retry will help.
        const { service, repository } = makeHarness(async () => {
            throw new Error("invalid_grant");
        });
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() - HOUR) });

        await expect(service.getValidAccessToken(integration)).rejects.toThrow(/reconnect/i);
        expect(repository.updateStatus).toHaveBeenCalledWith(integration.id, "EXPIRED");
    });

    it("still surfaces the token failure if marking EXPIRED itself fails", async () => {
        // The status flip is best-effort; a database hiccup there must not
        // turn an auth failure into a confusing unrelated error.
        const { service, repository } = makeHarness(async () => {
            throw new Error("invalid_grant");
        });
        repository.updateStatus.mockRejectedValueOnce(new Error("db down") as never);
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() - HOUR) });

        await expect(service.getValidAccessToken(integration)).rejects.toThrow(/reconnect/i);
    });

    it("uses the adapter for the integration's own provider", async () => {
        const { service, factory } = makeHarness();
        const integration = integrationWith({
            provider: "gitlab", tokenExpiresAt: new Date(Date.now() - HOUR)
        });

        await service.getValidAccessToken(integration);

        expect(factory.create).toHaveBeenCalledWith("gitlab");
    });

    it("handles a refresh response that omits a new expiry", async () => {
        // A provider may return a non-expiring token on refresh; that must
        // be stored as "no expiry" rather than an Invalid Date.
        const { service, repository } = makeHarness(async () => ({
            accessToken: "new-access-token", refreshToken: "r2", expiresAt: undefined
        }));
        const integration = integrationWith({ tokenExpiresAt: new Date(Date.now() - HOUR) });

        await service.getValidAccessToken(integration);

        expect(repository.updateTokens.mock.calls[0][3]).toBeUndefined();
    });
});
