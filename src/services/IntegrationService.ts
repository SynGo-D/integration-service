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
    connect(url: string): ConnectRepositoryResponse {

        const provider = this.providerFactory.getProvider(url);

        const resource = provider.parse(url);

        return {

            success: true,

            resource

        };

    }

}