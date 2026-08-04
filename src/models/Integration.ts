// src/models/Integration.ts

export interface Integration {
    id: string;
    userId: string;
    provider: "github" | "gitlab";
    accessToken: string;
    refreshToken?: string;
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
    createdAt: Date;
    updatedAt: Date;
}
