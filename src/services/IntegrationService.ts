import { randomUUID } from "crypto";
import { ProviderFactory } from "../factories/ProviderFactory";
import { IntegrationRepository } from "../repositories/IntegrationRepository";
import { OrganizationRepository } from "../repositories/OrganizationRepository";
import { RepositoryRepository } from "../repositories/RepositoryRepository";
import { Integration } from "../models/Integration";
import { Organization } from "../models/Organization";
import { Repository } from "../models/Repository";

export class IntegrationService {
    private readonly integrationRepository = new IntegrationRepository();
    private readonly organizationRepository = new OrganizationRepository();
    private readonly repositoryRepository = new RepositoryRepository();

    async connect(provider: "github" | "gitlab", token: string, userId: string): Promise<Integration> {
        const adapter = ProviderFactory.create(provider);
        await adapter.authenticate({ token });

        const integration: Integration = {
            id: randomUUID(),
            userId,
            provider,
            accessToken: token,
            refreshToken: undefined,
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        return this.integrationRepository.createIntegration(integration);
    }

    async sync(integrationId: string): Promise<void> {
        const integration = await this.integrationRepository.findById(integrationId);
        if (!integration) {
            throw new Error("Integration not found.");
        }

        const adapter = ProviderFactory.create(integration.provider);
        const organizations = await adapter.getOrganizations(integration.accessToken);

        for (const providerOrg of organizations) {
            const organization: Organization = {
                id: randomUUID(),
                integrationId: integration.id,
                externalId: providerOrg.externalId,
                name: providerOrg.name,
                provider: providerOrg.provider,
                createdAt: new Date(),
            };

            const savedOrganization = await this.organizationRepository.createOrUpdate(organization);
            const repositories = await adapter.getRepositories(integration.accessToken, providerOrg.externalId);

            for (const providerRepo of repositories) {
                const repository: Repository = {
                    id: randomUUID(),
                    organizationId: savedOrganization.id,
                    externalId: providerRepo.externalId,
                    name: providerRepo.name,
                    fullName: providerRepo.fullName,
                    cloneUrl: providerRepo.cloneUrl,
                    defaultBranch: providerRepo.defaultBranch,
                    language: providerRepo.language,
                    visibility: providerRepo.visibility,
                    lastUpdated: providerRepo.lastUpdated ? new Date(providerRepo.lastUpdated) : undefined,
                    createdAt: new Date(),
                };

                await this.repositoryRepository.createOrUpdate(repository);
            }
        }
    }

    async getIntegrations(userId: string): Promise<Integration[]> {
        return this.integrationRepository.findByUser(userId);
    }

    async getRepositories(integrationId: string): Promise<Repository[]> {
        const organizations = await this.organizationRepository.findByIntegration(integrationId);
        const repositories: Repository[] = [];

        for (const organization of organizations) {
            const orgRepos = await this.repositoryRepository.findByOrganization(organization.id);
            repositories.push(...orgRepos);
        }

        return repositories;
    }
}
