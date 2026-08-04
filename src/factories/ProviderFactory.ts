import { ProviderAdapter } from "../adapters/ProviderAdapter";
import { GithubAdapter } from "../adapters/GithubAdapter";
import { GitlabAdapter } from "../adapters/GitlabAdapter";

/**
 * Returns the correct adapter for the requested provider.
 */
export class ProviderFactory {

    public static create(provider: string): ProviderAdapter {
        switch (provider.toLowerCase()) {
            case "github":
                return new GithubAdapter();
            case "gitlab":
                return new GitlabAdapter();
            default:
                throw new Error("Unsupported provider. Expected 'github' or 'gitlab'.");
        }
    }

}
