import { ProviderFactory } from "../factories/ProviderFactory";
import { ConnectRepositoryResponse } from "../types/ConnectRepositoryResponse";

/**
 * Handles repository connection logic.
 */
export class IntegrationService {

    constructor(
        private readonly providerFactory: ProviderFactory
    ) {}

    /**
     * Detects the provider and parses the repository URL.
     */
    async connect(url: string): Promise<ConnectRepositoryResponse> {
        const provider = this.providerFactory.getProvider(url);

        const resource = provider.parse(url);

        try {

            const metadata = await provider.getPublicMetadata(resource);

            return {
                success: true,
                resource: metadata
            };

        } catch (error) {

            return {
                success: true,
                resource
            };

        }

    }

}