/**
 * ProviderFactory
 * -----------------------------------------------------------------------------
 * The single place in the codebase that knows about all concrete providers.
 * Everything else asks the factory: "give me the provider for platform=X"
 * or "give me the verifier for platform=X". This is a hand-rolled DI
 * container — no framework needed.
 *
 * Why a factory instead of just importing GitHubProvider directly?
 *   - Open/Closed: adding a new SCM = registering it in the factory. No
 *     existing route/service files change.
 *   - Testability: tests can build a factory backed by fake providers.
 *   - Configuration: env parsing happens ONCE at startup, not inside
 *     provider classes (which stay dependency-injected).
 */

import type { ScmPlatform, IScmProvider } from "../domain/interfaces/IScmProvider.js";
import type { IWebhookVerifier } from "../domain/interfaces/IWebhookVerifier.js";
import { UnsupportedPlatformError } from "../domain/errors/index.js";
import { GitHubProvider, type GitHubProviderConfig } from "./github/GitHubProvider.js";
import { GitHubWebhookVerifier } from "./github/GitHubWebhookVerifier.js";
import { GitLabProvider, type GitLabProviderConfig } from "./gitlab/GitLabProvider.js";
import { GitLabWebhookVerifier } from "./gitlab/GitLabWebhookVerifier.js";

export interface ProviderFactoryConfig {
  github: GitHubProviderConfig;
  gitlab: GitLabProviderConfig;
}

export class ProviderFactory {
  private readonly providers: Map<ScmPlatform, IScmProvider>;
  private readonly verifiers: Map<ScmPlatform, IWebhookVerifier>;

  constructor(cfg: ProviderFactoryConfig) {
    this.providers = new Map<ScmPlatform, IScmProvider>([
      ["github", new GitHubProvider(cfg.github)],
      ["gitlab", new GitLabProvider(cfg.gitlab)],
    ]);
    this.verifiers = new Map<ScmPlatform, IWebhookVerifier>([
      ["github", new GitHubWebhookVerifier()],
      ["gitlab", new GitLabWebhookVerifier()],
    ]);
  }

  getProvider(platform: string): IScmProvider {
    const p = this.providers.get(platform as ScmPlatform);
    if (!p) throw new UnsupportedPlatformError(`Unknown platform: ${platform}`);
    return p;
  }

  getVerifier(platform: string): IWebhookVerifier {
    const v = this.verifiers.get(platform as ScmPlatform);
    if (!v) throw new UnsupportedPlatformError(`Unknown platform: ${platform}`);
    return v;
  }

  /**
   * Ask each provider to try parsing the URL until one succeeds. Used when
   * the user pastes a URL and we don't yet know which platform it is
   * (FR-02.2 "identify whether it belongs to GitHub or GitLab").
   */
  detectFromUrl(url: string) {
    for (const [platform, provider] of this.providers) {
      try {
        const target = provider.parseTarget(url);
        return { platform, target };
      } catch {
        // try next provider
      }
    }
    throw new UnsupportedPlatformError(
      "URL is neither a recognisable GitHub nor GitLab URL",
    );
  }
}
