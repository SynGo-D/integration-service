// src/types/RepositoryPreview.ts

/**
 * Public metadata returned for a repository URL before OAuth.
 * The frontend displays this as a preview so the user can verify
 * the correct repository before clicking "Authorize".
 */
export interface RepositoryPreview {

    /** Detected source control provider. */
    provider: "github" | "gitlab";

    /** Canonical repository URL (normalised, .git suffix stripped). */
    repositoryUrl: string;

    repository: {
        owner: string;
        name: string;
        description?: string | null;
        language?: string | null;
        visibility: string;
        stars: number;
        forks: number;
        defaultBranch: string;
        updatedAt: string;
    };
}
