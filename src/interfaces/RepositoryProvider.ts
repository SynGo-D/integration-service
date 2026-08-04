import { RepositoryMetadata } from "../types/RepositoryMetadata";

/**
 * Represents any supported source control provider.
 * Every provider (GitHub, GitLab, etc.) must implement this contract.
 */
export interface RepositoryProvider {

    /**
     * Returns true if this provider can handle the given URL.
     */
    supports(url: string): boolean;

    /**
     * Extracts useful information from the URL.
     */
    parse(url: string): ParsedResource;

    /**
     * Retrieves public metadata for the parsed resource.
     */
    getPublicMetadata(
        resource: ParsedResource
    ): Promise<RepositoryMetadata>;
}

/**
 * Represents the parsed information from a repository or organization URL.
 */
export interface ParsedResource {

    provider: string;

    resourceType: "repository" | "organization" | "project" | "group";

    owner: string;

    name: string;

    fullName: string;
}

