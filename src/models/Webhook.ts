// src/models/Webhook.ts

/*
    Represents the webhook configuration
    associated with a managed repository.
*/
export interface Webhook {

    id: string;

    managedRepositoryId: string;

    providerWebhookId?: string;

    secretHash: string;

    events: string[];

    status:
        | "ACTIVE"
        | "DISABLED"
        | "FAILED";

    lastDeliveryAt?: Date;

    createdAt: Date;

    updatedAt: Date;

}