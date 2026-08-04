// src/models/SourceControlConnection.ts

/*
    Represents an authenticated connection
    to a source control provider such as
    GitHub or GitLab.
*/
export interface SourceControlConnection {

    id: string;

    provider: "github" | "gitlab";

    providerUserId: string;

    providerUsername: string;

    accessToken: string;

    refreshToken?: string;

    expiresAt?: Date;

    status: "ACTIVE" | "REVOKED" | "EXPIRED";

    createdAt: Date;

    updatedAt: Date;

}