// src/models/ManagedRepository.ts

/*
    Represents a repository that the
    platform actively monitors.
*/
export interface ManagedRepository {

    id: string;

    resourceId: string;

    analysisEnabled: boolean;

    webhookEnabled: boolean;

    qualityGateEnabled: boolean;

    lastSyncedAt?: Date;

    status:
        | "ACTIVE"
        | "DISABLED"
        | "ARCHIVED";

    createdAt: Date;

    updatedAt: Date;

}