/**
 * RepositoryPreviewService
 * -----------------------------------------------------------------------------
 * Implements FR-02.1, FR-02.2, FR-02.4, FR-02.5:
 *
 *   FR-02.1  Validate URL, detect GitHub vs GitLab.
 *   FR-02.2  Retrieve & return the metadata that the front end will render
 *            BEFORE authorization.
 *   FR-02.4  If public metadata is unavailable, return what we can extract
 *            from the URL alone (owner, repo).
 *   FR-02.5  Present it — the actual "presenting" is the front end's job;
 *            this service returns the payload it needs.
 *
 * SOLID: this class is deliberately thin. All the platform-specific logic
 * lives in IRepositoryReader implementations. Adding a new SCM = add a
 * provider, register it in the factory, done — this file doesn't change
 * (Open/Closed).
 */

import type { ProviderFactory } from "../providers/ProviderFactory.js";
import type { RepositoryPreview } from "../domain/interfaces/IScmProvider.js";

export class RepositoryPreviewService {
  constructor(private readonly factory: ProviderFactory) {}

  async previewFromUrl(url: string): Promise<RepositoryPreview> {
    const { platform, target } = this.factory.detectFromUrl(url);
    const provider = this.factory.getProvider(platform);
    return provider.fetchPreview(target);
  }
}
