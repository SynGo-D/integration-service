import {
    ParsedResource,
    RepositoryProvider
} from "../interfaces/RepositoryProvider";

/**
 * Handles GitLab URL parsing.
 */
export class GitLabProvider implements RepositoryProvider {

    supports(url: string): boolean {
        return url.includes("gitlab.com");
    }

    parse(url: string): ParsedResource {

        const pathname = new URL(url).pathname;

        const parts = pathname
            .split("/")
            .filter(Boolean);

        if (parts.length === 1) {

            return {
                provider: "gitlab",
                resourceType: "group",
                owner: parts[0],
                name: parts[0],
                fullName: parts[0]
            };
        }

        return {
            provider: "gitlab",
            resourceType: "project",
            owner: parts[0],
            name: parts[1],
            fullName: `${parts[0]}/${parts[1]}`
        };
    }

}