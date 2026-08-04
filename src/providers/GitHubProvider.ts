import {
    ParsedResource,
    RepositoryProvider
} from "../interfaces/RepositoryProvider";
import { RepositoryMetadata } from "../types/RepositoryMetadata";
import { GitHubApiClient } from "../clients/GitHubApiClient";


/**
 * Handles GitHub-specific URL parsing.
 */
export class GitHubProvider implements RepositoryProvider {

    /**
     * Checks whether the URL belongs to GitHub.
     */
    supports(url: string): boolean {
        return url.includes("github.com");
    }

    /**
     * Parses GitHub repository or organization URLs.
     */
    parse(url: string): ParsedResource {

        const pathname = new URL(url).pathname;

        const parts = pathname
            .split("/")
            .filter(Boolean);

        if (parts.length === 1) {

            return {
                provider: "github",
                resourceType: "organization",
                owner: parts[0],
                name: parts[0],
                fullName: parts[0]
            };
        }

        return {
            provider: "github",
            resourceType: "repository",
            owner: parts[0],
            name: parts[1],
            fullName: `${parts[0]}/${parts[1]}`
        };
    }

    private readonly apiClient = new GitHubApiClient();

    async getPublicMetadata(
        resource: ParsedResource
    ): Promise<RepositoryMetadata> {

        if (resource.resourceType === "repository") {

            const repository =
                await this.apiClient.getRepository(
                    resource.owner,
                    resource.name
                );

            const languages =
                await this.apiClient.getLanguages(
                    resource.owner,
                    resource.name
                );

            const contributors =
                await this.apiClient.getContributors(
                    resource.owner,
                    resource.name
                );

            return {

                provider: "github",

                resourceType: "repository",

                owner: repository.owner.login,

                name: repository.name,

                fullName: repository.full_name,

                description: repository.description,

                languages: Object.keys(languages),

                lastUpdated: repository.updated_at,

                contributors: contributors.length

            };

        }

        const organization =
            await this.apiClient.getOrganization(
                resource.name
            );

        const repositories =
            await this.apiClient.getOrganizationRepositories(
                resource.name
            );

        return {

            provider: "github",

            resourceType: "organization",

            owner: organization.login,

            name: organization.login,

            fullName: organization.login,

            description: organization.description,

            languages: [],

            repositories:

                repositories.map((repository: any) => ({

                    id: repository.id.toString(),

                    name: repository.name,

                    fullName: repository.full_name,

                    isPrivate: repository.private

                }))

        };

    }

}