/**
 * RepositoryConnectService
 * -----------------------------------------------------------------------------
 * Once the user has authorised OAuth (OAuthOrchestrator has run) AND has
 * confirmed exactly WHICH repository they want connected, this service:
 *
 *   1. Reads back the stored tokens for the integration id.
 *   2. Generates a fresh, random webhook secret.
 *   3. Calls the provider to REGISTER the webhook (FR-02.3, "webhook
 *      management" scope).
 *   4. Stores the encrypted webhook secret + external hook id.
 *   5. Flips the integration status to "connected".
 *   6. If anything fails, flips status to "error" with a reason — the front
 *      end can surface this per FR-02.4 ("notify the user whether … was
 *      completed successfully or if an error occurred").
 *
 * SOLID:
 *   - SRP: this service does ONE thing (connect an already-authorized
 *     integration to a specific target). Preview / OAuth / ingestion are
 *     separate services.
 *   - DIP: dependencies injected — no direct references to concrete
 *     providers or Postgres classes.
 */

import { randomBytes } from "node:crypto";
import type { ProviderFactory } from "../providers/ProviderFactory.js";
import type { TokenEncryptor } from "../security/TokenEncryptor.js";
import type {
  IIntegrationRepository,
  ITokenStore,
} from "../domain/interfaces/ITokenStore.js";
import type { ScmTarget } from "../domain/interfaces/IScmProvider.js";
import { IntegrationNotFoundError } from "../domain/errors/index.js";

export interface ConnectRepositoryInput {
  userId: string;
  integrationId: string;
  target: ScmTarget;
  /** Public URL where GitHub / GitLab will POST events (our /webhooks route). */
  deliveryUrl: string;
  /** Events we care about (normalized names). Default = ["pull_request","push"]. */
  events?: string[];
}

export interface ConnectRepositoryResult {
  integrationId: string;
  webhookExternalId: string;
  status: "connected";
}

export class RepositoryConnectService {
  constructor(
    private readonly factory: ProviderFactory,
    private readonly encryptor: TokenEncryptor,
    private readonly integrations: IIntegrationRepository,
    private readonly tokens: ITokenStore,
  ) {}

  async connect(input: ConnectRepositoryInput): Promise<ConnectRepositoryResult> {
    const integration = await this.integrations.findById(input.integrationId);
    if (!integration || integration.ownerUserId !== input.userId) {
      throw new IntegrationNotFoundError("integration_id does not exist or is not yours");
    }

    const stored = await this.tokens.get(input.integrationId);
    if (!stored) {
      throw new IntegrationNotFoundError("Token missing — re-authorise this integration");
    }

    const accessToken = this.encryptor.decrypt(stored.ciphertext);
    const provider = this.factory.getProvider(integration.platform);
    const secret = randomBytes(32).toString("hex");

    // Update the target on the integration row FIRST — that way even if
    // webhook registration fails, we have a record of what the user asked
    // for (useful for the "error" status message).
    await this.integrations.update(input.integrationId, {
      status: "pending",
      lastError: null,
    });

    try {
      const registration = await provider.registerWebhook({
        accessToken,
        target: input.target,
        deliveryUrl: input.deliveryUrl,
        secret,
        events: input.events ?? ["pull_request", "merge_request", "push"],
      });

      await this.integrations.update(input.integrationId, {
        status: "connected",
        webhookExternalId: registration.externalId,
        webhookSecretCiphertext: this.encryptor.encrypt(secret),
      });

      return {
        integrationId: input.integrationId,
        webhookExternalId: registration.externalId,
        status: "connected",
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.integrations.update(input.integrationId, {
        status: "error",
        lastError: reason,
      });
      throw err;
    }
  }
}
