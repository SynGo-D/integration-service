import { ProviderAdapter, ProviderCredentials, ProviderOrganization, ProviderRepository, ProviderUser } from "./ProviderAdapter";
import axios, { AxiosInstance } from "axios";
import { RepositoryPreview } from "../types/RepositoryPreview";

const GITLAB_API_BASE = "https://gitlab.com/api/v4";

export class GitlabAdapter implements ProviderAdapter {
    private readonly client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: GITLAB_API_BASE,
            timeout: 10000,
            headers: {
                "Accept": "application/json"
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
            username: response.data.username,
            email: response.data.email,
            provider: "gitlab"
        };
    }

    async getOrganizations(token: string): Promise<ProviderOrganization[]> {
        const response = await this.client.get("/groups", {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data.map((group: any) => ({
            id: group.id.toString(),
            externalId: group.full_path,
            name: group.full_path,
            provider: "gitlab"
        }));
    }

    async getRepositories(token: string, organizationExternalId: string): Promise<ProviderRepository[]> {
        const response = await this.client.get(`/groups/${encodeURIComponent(organizationExternalId)}/projects`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return response.data.map((project: any) => ({
            id: project.id.toString(),
            externalId: project.id.toString(),
            name: project.name,
            fullName: project.path_with_namespace,
            cloneUrl: project.http_url_to_repo,
            defaultBranch: project.default_branch,
            language: project.language,
            visibility: project.visibility,
            lastUpdated: project.last_activity_at,
            organizationExternalId: organizationExternalId
        }));
    }

    async getRepositoryDetails(token: string, repositoryExternalId: string): Promise<ProviderRepository> {
        const response = await this.client.get(`/projects/${encodeURIComponent(repositoryExternalId)}`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        return {
            id: response.data.id.toString(),
            externalId: response.data.id.toString(),
            name: response.data.name,
            fullName: response.data.path_with_namespace,
            cloneUrl: response.data.http_url_to_repo,
            defaultBranch: response.data.default_branch,
            language: response.data.language,
            visibility: response.data.visibility,
            lastUpdated: response.data.last_activity_at,
            organizationExternalId: response.data.namespace?.full_path
        };
    }

    async getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview> {
        const normalizedUrl = url.trim().replace(/\.git$/u, "");
        const match = normalizedUrl.match(/^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)$/iu);
        if (!match) {
            throw new Error("Invalid GitLab repository URL.");
        }

        const path = match[1];
        const response = await this.client.get(`/projects/${encodeURIComponent(path)}`);

        return {
            provider: "gitlab",
            repository: {
                owner: response.data.namespace?.full_path ?? "",
                name: response.data.name,
                description: response.data.description,
                language: response.data.language,
                visibility: response.data.visibility,
                stars: response.data.star_count,
                forks: response.data.forks_count,
                defaultBranch: response.data.default_branch,
                updatedAt: response.data.last_activity_at
            }
        };
    }
}
