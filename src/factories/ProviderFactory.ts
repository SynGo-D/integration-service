import { RepositoryProvider } from "../interfaces/RepositoryProvider";
import { GitHubProvider } from "../providers/GitHubProvider";
import { GitLabProvider } from "../providers/GitLabProvider";

/**
 * Creates the correct provider based on the URL.
 */
export class ProviderFactory {

    private readonly providers: RepositoryProvider[];

    constructor() {
        this.providers = [
            new GitHubProvider(),
            new GitLabProvider()
        ];
    }

    /**
     * Finds the first provider that supports the given URL.
     */
    public getProvider(url: string): RepositoryProvider {

        const provider = this.providers.find(p => p.supports(url));

        if (!provider) {
            throw new Error("Unsupported source control provider.");
        }

        return provider;
    }

}