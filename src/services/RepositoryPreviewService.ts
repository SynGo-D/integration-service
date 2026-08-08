// src/services/RepositoryPreviewService.ts

import { ProviderFactory } from "../factories/ProviderFactory.js";
import { RepositoryUrlParser } from "../utils/RepositoryUrlParser.js";
import { RepositoryPreview } from "../types/RepositoryPreview.js";
import { ValidationError } from "../errors/ValidationError.js";

/**
 * Thin service that fetches public repository metadata for the preview panel.
 *
 * No authentication is required — the adapters call the provider's public API.
 * Business logic is minimal here; the heavy lifting is in the adapters.
 *
 * Note: `IntegrationService.getRepositoryPreview` also exposes this capability.
 * This service exists so the RepositoryPreviewController has a focused dependency.
 */
export class RepositoryPreviewService {

    async getRepositoryPreview(url: string): Promise<RepositoryPreview> {
        if (!url || typeof url !== "string") {
            throw new ValidationError("Repository URL is required.");
        }

        const parsed  = RepositoryUrlParser.parse(url);
        const adapter = ProviderFactory.create(parsed.provider);

        return adapter.getPublicRepositoryMetadata(url);
    }
}
