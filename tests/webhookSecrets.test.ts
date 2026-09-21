import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { env } from "../src/config/env.js";
import { requireInternalToken } from "../src/middleware/requireInternalToken.js";
import { IntegrationService, ProviderAdapterFactory } from "../src/services/IntegrationService.js";
import { ProviderAdapter } from "../src/adapters/ProviderAdapter.js";

// ---------------------------------------------------------------------------
// requireInternalToken — the only thing standing between the public network
// and an endpoint that hands out webhook secrets.
// ---------------------------------------------------------------------------

function runMiddleware(authorization?: string) {
    const req = { headers: authorization === undefined ? {} : { authorization } } as never;
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        status(code: number) { this.statusCode = code; return this; },
        json(body: unknown) { this.body = body; return this; }
    };
    const next = vi.fn();
    requireInternalToken(req, res as never, next);
    return { res, next };
}

describe("requireInternalToken", () => {
    const TOKEN = "internal-test-token-0123456789abcdef";

    beforeEach(() => { env.INTERNAL_SERVICE_TOKEN = TOKEN; });

    it("lets a request with the correct bearer token through", () => {
        const { next } = runMiddleware(`Bearer ${TOKEN}`);
        expect(next).toHaveBeenCalledOnce();
    });

    it.each([
        ["no header", undefined],
        ["wrong token", "Bearer internal-test-token-XXXXXXXXXXXXXXXX"],
        ["wrong scheme", `Basic ${TOKEN}`],
        ["bare token without scheme", TOKEN],
        ["shorter token", "Bearer short"],
        ["empty bearer", "Bearer "],
    ])("rejects %s with 401", (_label, header) => {
        const { res, next } = runMiddleware(header);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it("fails closed when no token is configured, rather than skipping the check", () => {
        env.INTERNAL_SERVICE_TOKEN = "";
        // An empty presented token must not match an empty configured one.
        const { res, next } = runMiddleware("Bearer ");
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(503);
    });
});

// ---------------------------------------------------------------------------
// getWebhookSecrets — the allowlist + key lookup webhook-listener relies on.
// ---------------------------------------------------------------------------

function serviceWithStoredSecrets(stored: Array<string | null>) {
    const repository = { findActiveWebhookSecrets: vi.fn(async () => stored) };
    return { service: new IntegrationService(repository as never), repository };
}

describe("IntegrationService.getWebhookSecrets", () => {
    it("returns no secrets for a repository with no active integration", async () => {
        const { service } = serviceWithStoredSecrets([]);
        expect(await service.getWebhookSecrets("github", "acme/shop"))
            .toEqual({ secrets: [], legacy: false });
    });

    it("returns every active integration's secret for a repository two users connected", async () => {
        const { service } = serviceWithStoredSecrets(["secret-a", "secret-b"]);
        expect(await service.getWebhookSecrets("github", "acme/shop"))
            .toEqual({ secrets: ["secret-a", "secret-b"], legacy: false });
    });

    it("flags legacy only when an active integration has no secret of its own", async () => {
        const { service } = serviceWithStoredSecrets(["secret-a", null]);
        expect(await service.getWebhookSecrets("github", "acme/shop"))
            .toEqual({ secrets: ["secret-a"], legacy: true });
    });

    it("splits GitLab nested namespaces on the last slash", async () => {
        const { service, repository } = serviceWithStoredSecrets([]);
        await service.getWebhookSecrets("gitlab", "group/subgroup/shop");
        expect(repository.findActiveWebhookSecrets).toHaveBeenCalledWith("gitlab", "group/subgroup", "shop");
    });

    it.each([["bitbucket", "acme/shop"], ["github", "noslash"], ["github", "/shop"], ["github", "acme/"]])(
        "rejects invalid input (%s, %s)",
        async (provider, repository) => {
            const { service } = serviceWithStoredSecrets([]);
            await expect(service.getWebhookSecrets(provider, repository)).rejects.toThrow();
        }
    );
});

// ---------------------------------------------------------------------------
// Webhook registration — each integration must get its *own* secret.
// ---------------------------------------------------------------------------

describe("webhook registration during the OAuth callback", () => {
    function harness() {
        const calls: string[] = [];
        const adapter = {
            exchangeAuthorizationCode: vi.fn(async () => ({
                accessToken: "tok", providerUser: { id: "1", username: "alice", provider: "github" }
            })),
            registerWebhook: vi.fn(async () => { calls.push("register"); return { providerWebhookId: "hook-1" }; })
        } as unknown as ProviderAdapter;
        const factory: ProviderAdapterFactory = { create: () => adapter };
        const repository = {
            consumeOAuthNonce: vi.fn(async () => "consumed"),
            activateIntegration: vi.fn(async (id: string) => ({
                id, provider: "github", repositoryOwner: "acme", repositoryName: "shop"
            })),
            setWebhookSecret: vi.fn(async () => { calls.push("store-secret"); }),
            setWebhookId: vi.fn(async () => undefined)
        };
        const service = new IntegrationService(repository as never, factory);
        return { service, adapter, repository, calls };
    }

    const state = (id: string) => Buffer.from(JSON.stringify({
        integrationId: id, provider: "github", nonce: "n"
    })).toString("base64url");

    it("registers the hook with a freshly generated secret, not a shared one", async () => {
        const { service, adapter, repository } = harness();

        await service.handleOAuthCallback("code", state("int-1"), "github");

        const stored = repository.setWebhookSecret.mock.calls[0][1];
        const registered = (adapter.registerWebhook as ReturnType<typeof vi.fn>).mock.calls[0][4];
        expect(stored).toMatch(/^[0-9a-f]{64}$/u);
        expect(registered).toBe(stored);
    });

    it("gives two integrations two different secrets", async () => {
        const { service, repository } = harness();

        await service.handleOAuthCallback("code", state("int-1"), "github");
        await service.handleOAuthCallback("code", state("int-2"), "github");

        const [first, second] = repository.setWebhookSecret.mock.calls.map((c) => c[1]);
        expect(first).not.toBe(second);
    });

    it("stores the secret before creating the hook, so the provider's first ping can be verified", async () => {
        const { service, calls } = harness();

        await service.handleOAuthCallback("code", state("int-1"), "github");

        expect(calls).toEqual(["store-secret", "register"]);
    });
});
