// src/adapters/GitlabAdapter.ts

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

const GITLAB_API_BASE   = "https://gitlab.com/api/v4";
const GITLAB_OAUTH_BASE = "https://gitlab.com/oauth";

/**
 * GitLab implementation of the ProviderAdapter contract.
 *
 * Scope strategy (Principle of Least Privilege):
 *   • "read_repository" — allows reading repository contents.
 *   • "read_user"       — allows fetching the authenticated user profile.
 *   These are the minimum scopes required for Phase 1 single-repo integration.
 */
export class GitlabAdapter implements ProviderAdapter {

    private readonly client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: GITLAB_API_BASE,
            timeout: 10_000,
            headers: { Accept: "application/json" }
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
            username: response.data.username,
            email:    response.data.email ?? undefined,
            provider: "gitlab"
        };
    }

    async getOrganizations(token: string): Promise<ProviderOrganization[]> {
        const response = await this.client.get("/groups", {
            headers: { Authorization: `Bearer ${token}` }
        });

        return response.data.map((group: any) => ({
            id:         group.id.toString(),
            externalId: group.full_path,
            name:       group.full_path,
            provider:   "gitlab"
        }));
    }

    async getRepositories(
        token: string,
        organizationExternalId: string
    ): Promise<ProviderRepository[]> {
        const response = await this.client.get(
            `/groups/${encodeURIComponent(organizationExternalId)}/projects`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return response.data.map((project: any) =>
            this.mapProject(project, organizationExternalId)
        );
    }

    async getRepositoryDetails(
        token: string,
        repositoryExternalId: string
    ): Promise<ProviderRepository> {
        const response = await this.client.get(
            `/projects/${encodeURIComponent(repositoryExternalId)}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        return this.mapProject(response.data, response.data.namespace?.full_path);
    }

    // -----------------------------------------------------------------------
    // Unauthenticated operations
    // -----------------------------------------------------------------------

    async getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview> {
        const path     = this.parsePath(url);
        const response = await this.client.get(
            `/projects/${encodeURIComponent(path)}`
        );
        const d = response.data;

        return {
            provider:      "gitlab",
            repositoryUrl: `https://gitlab.com/${path}`,
            repository: {
                owner:         d.namespace?.full_path ?? "",
                name:          d.name,
                description:   d.description ?? null,
                language:      d.language ?? null,
                visibility:    d.visibility,
                stars:         d.star_count,
                forks:         d.forks_count,
                defaultBranch: d.default_branch,
                updatedAt:     d.last_activity_at
            }
        };
    }

    // -----------------------------------------------------------------------
    // OAuth flow
    // -----------------------------------------------------------------------

    generateAuthorizationUrl(state: string): string {
        if (!env.GITLAB_CLIENT_ID) {
            throw new AppError("GITLAB_CLIENT_ID is not configured.", 500);
        }

        const params = new URLSearchParams({
            client_id:     env.GITLAB_CLIENT_ID,
            redirect_uri:  env.GITLAB_CALLBACK_URL,
            response_type: "code",
            // Minimum scopes for Phase 1 single-repository integration
            scope:         "read_repository read_user",
            state
        });

        return `${GITLAB_OAUTH_BASE}/authorize?${params.toString()}`;
    }

    async exchangeAuthorizationCode(code: string): Promise<OAuthTokenResult> {
        if (!env.GITLAB_CLIENT_ID || !env.GITLAB_CLIENT_SECRET) {
            throw new AppError("GitLab OAuth credentials are not configured.", 500);
        }

        const tokenResponse = await axios.post(
            `${GITLAB_OAUTH_BASE}/token`,
            {
                client_id:     env.GITLAB_CLIENT_ID,
                client_secret: env.GITLAB_CLIENT_SECRET,
                code,
                grant_type:    "authorization_code",
                redirect_uri:  env.GITLAB_CALLBACK_URL
            },
            { headers: { "Content-Type": "application/json" } }
        );

        const data = tokenResponse.data;

        if (!data?.access_token) {
            const reason = data?.error_description ?? data?.error ?? "unknown";
            throw new AppError(
                `GitLab token exchange failed: ${reason}`,
                502
            );
        }

        const providerUser = await this.getUser(data.access_token);

        return {
            accessToken:  data.access_token,
            refreshToken: data.refresh_token ?? undefined,
            expiresAt:    data.expires_in
                ? new Date(Date.now() + data.expires_in * 1000).toISOString()
                : undefined,
            providerUser
        };
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Extracts the namespace/project path from a GitLab URL.
     * E.g. "https://gitlab.com/gitlab-org/gitlab" → "gitlab-org/gitlab"
     */
    private parsePath(url: string): string {
        const normalized = url.trim().replace(/\.git$/u, "").replace(/\/+$/u, "");
        const match      = normalized.match(
            /^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)$/iu
        );
        if (!match || !match[1].includes("/")) {
            throw new AppError("Invalid GitLab repository URL.", 400);
        }
        return match[1];
    }

    private mapProject(
        data: any,
        organizationExternalId?: string
    ): ProviderRepository {
        return {
            id:                     data.id.toString(),
            externalId:             data.id.toString(),
            name:                   data.name,
            fullName:               data.path_with_namespace,
            cloneUrl:               data.http_url_to_repo ?? undefined,
            defaultBranch:          data.default_branch ?? undefined,
            language:               data.language ?? undefined,
            visibility:             data.visibility,
            lastUpdated:            data.last_activity_at ?? undefined,
            organizationExternalId: organizationExternalId ?? data.namespace?.full_path
        };
    }
}
