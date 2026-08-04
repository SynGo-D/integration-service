// src/models/Repository.ts

export interface Repository {
    id: string;
    organizationId: string;
    externalId: string;
    name: string;
    fullName: string;
    cloneUrl?: string;
    defaultBranch?: string;
    language?: string;
    visibility?: string;
    lastUpdated?: Date;
    createdAt: Date;
}
