export interface RepositoryPreview {
    provider: "github" | "gitlab";
    repository: {
        owner: string;
        name: string;
        description?: string;
        language?: string;
        visibility?: string;
        stars: number;
        forks: number;
        defaultBranch: string;
        updatedAt: string;
    };
}
