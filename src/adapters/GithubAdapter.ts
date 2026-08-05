import { ProviderAdapter, ProviderCredentials, ProviderOrganization, ProviderRepository, ProviderUser } from "./ProviderAdapter";
import axios, { AxiosInstance } from "axios";
import { env } from "../config/env";
import { RepositoryPreview } from "../types/RepositoryPreview";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_OAUTH_BASE = "https://github.com/login/oauth";

export class GithubAdapter implements ProviderAdapter {
    private readonly client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: GITHUB_API_BASE,
            timeout: 10000,
            headers: {
                Accept: "application/vnd.github+json"
            }
        });
    }

    async authenticate(credentials: ProviderCredentials): Promise<ProviderUser> {
        return this.getUser(credentials.token);
    }

    async getUser(token: string): Promise<ProviderUser> {
        const response = await this.client.get("/user", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return {
            id: response.data.id.toString(),
            username: response.data.login,
            email: response.data.email,
            provider: "github"
        };
    }

    async getOrganizations(token: string): Promise<ProviderOrganization[]> {
        const response = await this.client.get("/user/orgs", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data.map((org: any) => ({
            id: org.id.toString(),
            externalId: org.login,
            name: org.login,
            provider: "github"
        }));
    }

    async getRepositories(token: string, organizationExternalId: string): Promise<ProviderRepository[]> {
        const response = await this.client.get(`/orgs/${organizationExternalId}/repos`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data.map((repo: any) => ({
            id: repo.id.toString(),
            externalId: repo.id.toString(),
            name: repo.name,
            fullName: repo.full_name,
            cloneUrl: repo.clone_url,
            defaultBranch: repo.default_branch,
            language: repo.language,
            visibility: repo.private ? "private" : "public",
            lastUpdated: repo.updated_at,
            organizationExternalId: organizationExternalId
        }));
    }

    async getRepositoryDetails(token: string, repositoryExternalId: string): Promise<ProviderRepository> {
        const response = await this.client.get(`/repositories/${repositoryExternalId}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return {
            id: response.data.id.toString(),
            externalId: response.data.id.toString(),
            name: response.data.name,
            fullName: response.data.full_name,
            cloneUrl: response.data.clone_url,
            defaultBranch: response.data.default_branch,
            language: response.data.language,
            visibility: response.data.private ? "private" : "public",
            lastUpdated: response.data.updated_at,
            organizationExternalId: response.data.owner?.login
        };
    }

    async getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview> {
        const normalizedUrl = url.trim().replace(/\.git$/u, "");
        const match = normalizedUrl.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+?)\/([^\/]+?)$/iu);
        if (!match) {
            throw new Error("Invalid GitHub repository URL.");
        }

        const owner = match[1];
        const repo = match[2];

        const response = await this.client.get(`/repos/${owner}/${repo}`);

        return {
            provider: "github",
            repository: {
                owner: response.data.owner.login,
                name: response.data.name,
                description: response.data.description,
                language: response.data.language,
                visibility: response.data.private ? "private" : "public",
                stars: response.data.stargazers_count,
                forks: response.data.forks_count,
                defaultBranch: response.data.default_branch,
                updatedAt: response.data.updated_at
            }
        };
    }

    generateAuthorizationUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: env.GITHUB_CLIENT_ID,
            redirect_uri: env.GITHUB_CALLBACK_URL,
            scope: "repo read:org",
            state,
            allow_signup: "true"
        });

        return `${GITHUB_OAUTH_BASE}/authorize?${params.toString()}`;
    }

    async exchangeAuthorizationCode(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string; providerUser: ProviderUser }> {
        const tokenResponse = await axios.post(
            `${GITHUB_OAUTH_BASE}/access_token`,
            {
                client_id: env.GITHUB_CLIENT_ID,
                client_secret: env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: env.GITHUB_CALLBACK_URL
            },
            {
                headers: {
                    Accept: "application/json"
                }
            }
        );

        if (!tokenResponse.data || !tokenResponse.data.access_token) {
            throw new Error("Failed to exchange authorization code for access token.");
        }

        const accessToken = tokenResponse.data.access_token;
        const providerUser = await this.getUser(accessToken);

        return {
            accessToken,
            refreshToken: undefined,
            expiresAt: undefined,
            providerUser
        };
    }
}
