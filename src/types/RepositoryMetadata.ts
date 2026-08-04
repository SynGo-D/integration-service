/**
 * Metadata displayed before OAuth authorization.
 */
export interface RepositoryMetadata {

    provider: "github" | "gitlab";

    resourceType:
        | "repository"
        | "organization"
        | "project"
        | "group";

    owner: string;

    name: string;

    fullName: string;

    description?: string;

    languages: string[];

    lastUpdated?: string;

    contributors?: number;

    repositories?: RepositorySummary[];
}

/**
 * Summary used when displaying repositories
 * inside an organization or group.
 */
export interface RepositorySummary {

    id: string;

    name: string;

    fullName: string;

    isPrivate: boolean;

}