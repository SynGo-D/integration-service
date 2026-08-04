// src/models/Organization.ts

export interface Organization {
    id: string;
    integrationId: string;
    externalId: string;
    name: string;
    provider: "github" | "gitlab";
    createdAt: Date;
}
