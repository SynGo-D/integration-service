export interface ProviderCredentials {
    token: string;
}

export interface ProviderUser {
    id: string;
    username: string;
    email?: string;
    provider: "github" | "gitlab";
}

export interface ProviderOrganization {
    id: string;
    externalId: string;
    name: string;
    provider: "github" | "gitlab";
}

export interface ProviderRepository {
    id: string;
    externalId: string;
    name: string;
    fullName: string;
    cloneUrl?: string;
    defaultBranch?: string;
    language?: string;
    visibility?: string;
    lastUpdated?: string;
    organizationExternalId?: string;
}

import { RepositoryPreview } from "../types/RepositoryPreview";

export interface ProviderAdapter {
    authenticate(credentials: ProviderCredentials): Promise<ProviderUser>;
    getUser(token: string): Promise<ProviderUser>;
    getOrganizations(token: string): Promise<ProviderOrganization[]>;
    getRepositories(token: string, organizationExternalId: string): Promise<ProviderRepository[]>;
    getRepositoryDetails(token: string, repositoryExternalId: string): Promise<ProviderRepository>;
    getPublicRepositoryMetadata(url: string): Promise<RepositoryPreview>;
    exchangeAuthorizationCode?(code: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string; providerUser: ProviderUser }>;
    generateAuthorizationUrl?(state: string): string;
}
