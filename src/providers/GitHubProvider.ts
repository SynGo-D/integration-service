import {
    ParsedResource,
    RepositoryProvider
} from "../interfaces/RepositoryProvider";

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

}