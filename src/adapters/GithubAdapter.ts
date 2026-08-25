// src/adapters/GithubAdapter.ts

import axios, { AxiosInstance } from "axios";
import {
    OAuthTokenResult,
    ProviderAdapter,
    ProviderCredentials,
    ProviderOrganization,
    ProviderRepository,
    ProviderUser
} from "./ProviderAdapter.js";
import { env } from "../config/env.js";
import { RepositoryPreview } from "../types/RepositoryPreview.js";
import { AppError } from "../errors/AppError.js";

const GITHUB_API_BASE   = "https://api.github.com";
const GITHUB_OAUTH_BASE = "https://github.com/login/oauth";

/**
 * GitHub implementation of the ProviderAdapter contract.
 *
 * Scope strategy (Principle of Least Privilege):
 *   • Phase 1 only needs to read a single repository → "repo" scope is
 *     sufficient.  "read:org" is omitted because organization access is
 *     not required for single-repo integration.
 */
export class GithubAdapter implements ProviderAdapter {

    private readonly client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: GITHUB_API_BASE,
            timeout: 10_000,
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"
            }
        });
    }

    // -----------------------------------------------------------------------
    // Authenticated operations
    // -----------------------------------------------------------------------

    async authenticate(credentials: ProviderCredentials): Promise<ProviderUser> {
        return this.getUser(credentials.token);
    }

    async getUser(token: string): Promise<ProviderUser> {
        const response = await this.client.get("/user", {
            headers: { Authorization: `Bearer ${token}` }
        });

        return {
            id:       response.data.id.toString(),
            username: response.data.login,
            email:    response.data.email ?? undefined,
            provider: "github"
        };
    }

    async getOrganizations(token: string): Promise<ProviderOrganization[]> {
        const response = await this.client.get("/user/orgs", {
            headers: { Authorization: `Bearer ${token}` }
        });

        return response.data.map((org: any) => ({
            id:         org.id.toString(),
            externalId: org.login,
            name:       org.login,
            provider:   "github"
        }));
    }

    async getRepositories(
        token: string,
        organizationExternalId: string
    ): Promise<ProviderRepository[]> {
        const response = await this.client.get(
            `/orgs/${organizationExternalId}/repos`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return response.data.map((repo: any) => this.mapRepo(repo, organizationExternalId));
    }

    async getRepositoryDetails(
        token: string,
        repositoryExternalId: string
    ): Promise<ProviderRepository> {
        const response = await this.client.get(
            `/repositories/${repositoryExternalId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return this.mapRepo(response.data, response.data.owner?.login);
    }

    // -----------------------------------------------------------------------
    // Unauthenticated operations
    // -----------------------------------------------------------------------

    async getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview> {
        const { owner, repo } = this.parseUrl(url);
        const response        = await this.client.get(`/repos/${owner}/${repo}`);
        const d               = response.data;

        return {
            provider:      "github",
            repositoryUrl: `https://github.com/${owner}/${repo}`,
            repository: {
                owner:         d.owner.login,
                name:          d.name,
                description:   d.description ?? null,
                language:      d.language ?? null,
                visibility:    d.private ? "private" : "public",
                stars:         d.stargazers_count,
                forks:         d.forks_count,
                defaultBranch: d.default_branch,
                updatedAt:     d.updated_at
            }
        };
    }

    // -----------------------------------------------------------------------
    // OAuth flow
    // -----------------------------------------------------------------------

    generateAuthorizationUrl(state: string): string {
        if (!env.GITHUB_CLIENT_ID) {
            throw new AppError("GITHUB_CLIENT_ID is not configured.", 500);
        }

        const params = new URLSearchParams({
            client_id:    env.GITHUB_CLIENT_ID,
            redirect_uri: env.GITHUB_CALLBACK_URL,
            // Minimum scope: read/write access to a single repo.
            // "read:org" is intentionally omitted — not needed for Phase 1.
            scope:        "repo",
            state,
            allow_signup: "false"
        });

        return `${GITHUB_OAUTH_BASE}/authorize?${params.toString()}`;
    }

    async exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult> {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
            throw new AppError("GitHub OAuth credentials are not configured.", 500);
        }

        const tokenResponse = await axios.post(
            `${GITHUB_OAUTH_BASE}/access_token`,
            {
                client_id:     env.GITHUB_CLIENT_ID,
                client_secret: env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri:  env.GITHUB_CALLBACK_URL
            },
            { headers: { Accept: "application/json" } }
        );

        const data = tokenResponse.data;

        if (!data?.access_token) {
            const reason = data?.error_description ?? data?.error ?? "unknown";
            throw new AppError(
                `GitHub token exchange failed: ${reason}`,
                502
            );
        }

        const providerUser = await this.getUser(data.access_token);

        return {
            accessToken:  data.access_token,
            refreshToken: data.refresh_token ?? undefined,
            expiresAt:    undefined, // GitHub PATs do not expire by default
            providerUser
        };
    }

    // -----------------------------------------------------------------------
    // Webhook registration
    // -----------------------------------------------------------------------

    /**
     * The "repo" scope already granted for Phase 1 (see generateAuthorizationUrl)
     * includes write access to a repository's own webhooks, so no additional
     * scope is needed here — https://docs.github.com/rest/repos/webhooks.
     */
    async registerWebhook(
        token: string,
        owner: string,
        repo: string,
        callbackUrl: string,
        secret: string
    ): Promise<{ providerWebhookId: string }> {
        try {
            const response = await this.client.post(
                `/repos/${owner}/${repo}/hooks`,
                {
                    name:   "web",
                    active: true,
                    events: ["pull_request"],
                    config: {
                        url:          callbackUrl,
                        content_type: "json",
                        secret,
                        insecure_ssl: "0"
                    }
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            return { providerWebhookId: response.data.id.toString() };
        } catch (err: any) {
            const reason = err?.response?.data?.message ?? err?.message ?? "unknown error";
            throw new AppError(`GitHub webhook registration failed: ${reason}`, 502);
        }
    }

    async unregisterWebhook(
        token: string,
        owner: string,
        repo: string,
        providerWebhookId: string
    ): Promise<void> {
        try {
            await this.client.delete(`/repos/${owner}/${repo}/hooks/${providerWebhookId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (err: any) {
            // 404 means it's already gone (e.g. removed manually) — not an error worth failing revoke over.
            if (err?.response?.status === 404) return;
            const reason = err?.response?.data?.message ?? err?.message ?? "unknown error";
            throw new AppError(`GitHub webhook removal failed: ${reason}`, 502);
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private parseUrl(url: string): { owner: string; repo: string } {
        const normalized = url.trim().replace(/\.git$/u, "").replace(/\/+$/u, "");
        const match      = normalized.match(
            /^https?:\/\/(?:www\.)?github\.com\/([^/]+?)\/([^/]+?)$/iu
        );
        if (!match) {
            throw new AppError("Invalid GitHub repository URL.", 400);
        }
        return { owner: match[1], repo: match[2] };
    }

    private mapRepo(
        data: any,
        organizationExternalId?: string
    ): ProviderRepository {
        return {
            id:                     data.id.toString(),
            externalId:             data.id.toString(),
            name:                   data.name,
            fullName:               data.full_name,
            cloneUrl:               data.clone_url ?? undefined,
            defaultBranch:          data.default_branch ?? undefined,
            language:               data.language ?? undefined,
            visibility:             data.private ? "private" : "public",
            lastUpdated:            data.updated_at ?? undefined,
            organizationExternalId: organizationExternalId ?? data.owner?.login
        };
    }
}
