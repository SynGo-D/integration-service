// src/models/ConnectedResource.ts

/*
    Represents a repository, organization,
    project, or group discovered from
    a source control provider.
*/
export interface ConnectedResource {

    id: string;

    connectionId: string;

    providerResourceId: string;

    resourceType:
        | "repository"
        | "organization"
        | "project"
        | "group";

    parentResourceId?: string;

    name: string;

    fullName?: string;

    description?: string;

    ownerName?: string;

    visibility:
        | "public"
        | "private"
        | "internal";

    defaultBranch?: string;

    isArchived: boolean;

    webUrl?: string;

    createdAt: Date;

    updatedAt: Date;

}