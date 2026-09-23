// src/factories/ProviderFactory.ts

import { ProviderAdapter } from "../adapters/ProviderAdapter.js";
import { GithubAdapter } from "../adapters/GithubAdapter.js";
import { GitlabAdapter } from "../adapters/GitlabAdapter.js";

export type SupportedProvider = "github" | "gitlab";

/**
 * Factory that creates the correct ProviderAdapter for a given provider name.
 *
 * Why a factory?
 *   • Centralises adapter instantiation — callers only know about the interface.
 *   • Adding a new provider (Bitbucket, Azure DevOps, …) requires only:
 *       1. Implement `ProviderAdapter`
 *       2. Add a case here
 *   • No changes to service or controller code are needed.
 *
 * Adapters are created fresh on each call (stateless); they hold no mutable
 * state, so there is no benefit to caching them as singletons.
 */
export class ProviderFactory {

    public static create(provider: string): ProviderAdapter {
        switch (provider.toLowerCase() as SupportedProvider) {
            case "github":
                return new GithubAdapter();
            case "gitlab":
                return new GitlabAdapter();
            default:
                throw new Error(
                    `Unsupported provider '${provider}'. Supported providers: github, gitlab.`
                );
        }
    }
}
