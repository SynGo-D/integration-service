import { ProviderFactory } from "../factories/ProviderFactory";
import { RepositoryUrlParser } from "../utils/RepositoryUrlParser";
import { RepositoryPreview } from "../types/RepositoryPreview";
import { ValidationError } from "../errors/ValidationError";

export class RepositoryPreviewService {
    public async getRepositoryPreview(url: string): Promise<RepositoryPreview> {
        if (!url || typeof url !== "string") {
            throw new ValidationError("Repository URL is required.");
        }

        const parsed = RepositoryUrlParser.parse(url);
        const adapter = ProviderFactory.create(parsed.provider);

        return adapter.getPublicRepositoryMetadata(url);
    }
}
