import { ProviderAdapter, ProviderCredentials, ProviderOrganization, ProviderRepository, ProviderUser } from "./ProviderAdapter";
import axios, { AxiosInstance } from "axios";

const GITHUB_API_BASE = "https://api.github.com";

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
}
