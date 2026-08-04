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

export interface ProviderAdapter {
    authenticate(credentials: ProviderCredentials): Promise<ProviderUser>;
    getUser(token: string): Promise<ProviderUser>;
    getOrganizations(token: string): Promise<ProviderOrganization[]>;
    getRepositories(token: string, organizationExternalId: string): Promise<ProviderRepository[]>;
    getRepositoryDetails(token: string, repositoryExternalId: string): Promise<ProviderRepository>;
}
