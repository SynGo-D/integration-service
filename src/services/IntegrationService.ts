import { randomUUID } from "crypto";
import { ProviderFactory } from "../factories/ProviderFactory";
import { IntegrationRepository } from "../repositories/IntegrationRepository";
import { OrganizationRepository } from "../repositories/OrganizationRepository";
import { RepositoryRepository } from "../repositories/RepositoryRepository";
import { Integration } from "../models/Integration";
import { Organization } from "../models/Organization";
import { Repository } from "../models/Repository";
import { AppError } from "../errors/AppError";
import { ProviderUser } from "../adapters/ProviderAdapter";

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

    async generateGithubAuthorizationUrl(userId: string): Promise<string> {
        if (!userId || typeof userId !== "string") {
            throw new AppError("userId is required to start OAuth.", 400);
        }

        const adapter = ProviderFactory.create("github");
        if (!adapter.generateAuthorizationUrl) {
            throw new AppError("GitHub OAuth is not supported.", 500);
        }

        const state = JSON.stringify({ userId });
        return adapter.generateAuthorizationUrl(state);
    }

    async handleGithubOAuthCallback(code: string, state: string): Promise<{ success: boolean; integrationId: string; provider: "github" | "gitlab"; user: ProviderUser }> {
        if (!code || typeof code !== "string") {
            throw new AppError("Authorization code is required.", 400);
        }

        const parsedState = this.parseOAuthState(state);
        const userId = parsedState.userId;

        const adapter = ProviderFactory.create("github");
        if (!adapter.exchangeAuthorizationCode) {
            throw new AppError("GitHub OAuth is not supported.", 500);
        }

        const oauthResult = await adapter.exchangeAuthorizationCode(code);
        const providerUser = await adapter.authenticate({ token: oauthResult.accessToken });

        const integration: Integration = {
            id: randomUUID(),
            userId,
            provider: "github",
            accessToken: oauthResult.accessToken,
            refreshToken: oauthResult.refreshToken,
            status: "ACTIVE",
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const savedIntegration = await this.integrationRepository.createIntegration(integration);
        await this.sync(savedIntegration.id);

        return {
            success: true,
            integrationId: savedIntegration.id,
            provider: savedIntegration.provider,
            user: providerUser
        };
    }

    private parseOAuthState(state: string): { userId: string } {
        if (!state || typeof state !== "string") {
            throw new AppError("Missing OAuth state.", 400);
        }

        try {
            const decoded = decodeURIComponent(state);
            const parsed = JSON.parse(decoded);

            if (!parsed || typeof parsed.userId !== "string") {
                throw new Error("Invalid state payload.");
            }

            return { userId: parsed.userId };
        } catch {
            throw new AppError("Invalid OAuth state.", 400);
        }
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
