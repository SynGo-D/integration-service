/**
 * WebhookIngressService
 * -----------------------------------------------------------------------------
 * Handles inbound webhook deliveries from GitHub and GitLab (FR-03.1).
 *
 * Responsibilities kept in this class:
 *   1. Given a raw request + platform, find the correct integration record
 *      by looking at the payload's repository identifier.
 *   2. Decrypt the stored webhook secret.
 *   3. Ask the platform's IWebhookVerifier to check the signature.
 *   4. Log the receipt (verified / not verified) into webhook_events.
 *   5. If verified, hand off to a downstream publisher (message queue). We
 *      keep the publisher behind an interface so tests can substitute an
 *      in-memory fake, AND so we can start with a no-op publisher in dev
 *      and swap to RabbitMQ later without touching this file (OCP).
 *
 * What we DELIBERATELY don't do here:
 *   - Parse/validate the full payload schema. That belongs to a downstream
 *     "normalizer" service consuming the queue, per FR-03.2/03.3 — keeping
 *     the ingress fast means fewer 5xxs and less risk of GitHub retry storms.
 */

import { randomUUID } from "node:crypto";
import type { ProviderFactory } from "../providers/ProviderFactory.js";
import type { TokenEncryptor } from "../security/TokenEncryptor.js";
import type {
  IIntegrationRepository,
} from "../domain/interfaces/ITokenStore.js";
import { query } from "../persistence/db.js";
import type { ScmPlatform } from "../domain/interfaces/IScmProvider.js";
import { WebhookSignatureInvalidError } from "../domain/errors/index.js";

/**
 * Minimal publisher interface. In production this is a RabbitMQ / Kafka /
 * SNS-SQS adapter; in dev we ship a NoopPublisher that just logs.
 */
export interface IEventPublisher {
  publish(topic: string, message: unknown): Promise<void>;
}

export class NoopPublisher implements IEventPublisher {
  async publish(topic: string, message: unknown): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[NoopPublisher] ${topic}`, JSON.stringify(message));
  }
}

export interface IngestInput {
  platform: ScmPlatform;
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
}

export class WebhookIngressService {
  constructor(
    private readonly factory: ProviderFactory,
    private readonly encryptor: TokenEncryptor,
    private readonly integrations: IIntegrationRepository,
    private readonly publisher: IEventPublisher,
    private readonly topic: string = "codepulse.webhook.raw",
  ) {}

  async ingest(input: IngestInput): Promise<{ accepted: boolean; deliveryId?: string }> {
    // Parse the JSON to extract the repository identifier — we need it to
    // look up the integration and therefore the secret. This isn't full
    // schema validation, just enough to route.
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      await this.log(input.platform, false, null, null, "invalid json body");
      throw new WebhookSignatureInvalidError("body is not JSON");
    }

    const target = this.extractTarget(input.platform, body);
    if (!target) {
      await this.log(input.platform, false, null, null, "could not extract repository");
      throw new WebhookSignatureInvalidError("payload missing repository identifier");
    }

    // At the webhook receiving side we don't have a user session, so we
    // look up by target only. Multiple users could each have their own
    // integration for the same repo — we accept the FIRST matching
    // integration whose status is "connected". A production version would
    // look up ALL integrations for this target and fan-out.
    const integ = await this.findAnyByTarget(input.platform, target);
    if (!integ || !integ.webhookSecretCiphertext) {
      await this.log(
        input.platform,
        false,
        input.headers["x-github-delivery"] ?? input.headers["x-gitlab-event-uuid"] ?? null,
        input.headers["x-github-event"] ?? input.headers["x-gitlab-event"] ?? null,
        "no matching integration",
      );
      throw new WebhookSignatureInvalidError("no matching integration");
    }

    const secret = this.encryptor.decrypt(integ.webhookSecretCiphertext);
    const verifier = this.factory.getVerifier(input.platform);
    const result = verifier.verify({
      rawBody: input.rawBody,
      headers: input.headers,
      secret,
    });
    if (!result.ok) {
      await this.log(
        input.platform,
        false,
        result.deliveryId ?? null,
        result.eventType ?? null,
        result.reason ?? "verification failed",
      );
      throw new WebhookSignatureInvalidError(result.reason ?? "verification failed");
    }

    // Verified. Publish a lightweight envelope; downstream orchestration
    // service (FR-04) will consume and enrich.
    const envelope = {
      integrationId: integ.id,
      platform: input.platform,
      eventType: result.eventType,
      deliveryId: result.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: body,
    };
    try {
      await this.publisher.publish(this.topic, envelope);
      await this.log(input.platform, true, result.deliveryId ?? null, result.eventType ?? null, null, true);
      return { accepted: true, deliveryId: result.deliveryId };
    } catch (err) {
      await this.log(
        input.platform,
        true,
        result.deliveryId ?? null,
        result.eventType ?? null,
        `publish failed: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
      throw err;
    }
  }

  private extractTarget(
    platform: ScmPlatform,
    body: Record<string, unknown>,
  ): { owner: string; repo: string | null } | null {
    if (platform === "github") {
      const repo = body.repository as { full_name?: string; owner?: { login?: string }; name?: string } | undefined;
      if (repo?.full_name && repo.full_name.includes("/")) {
        const [owner, name] = repo.full_name.split("/");
        return { owner, repo: name };
      }
      if (repo?.owner?.login && repo?.name) {
        return { owner: repo.owner.login, repo: repo.name };
      }
      return null;
    }
    // gitlab
    const project = body.project as { path_with_namespace?: string } | undefined;
    if (project?.path_with_namespace && project.path_with_namespace.includes("/")) {
      const idx = project.path_with_namespace.lastIndexOf("/");
      return {
        owner: project.path_with_namespace.slice(0, idx),
        repo: project.path_with_namespace.slice(idx + 1),
      };
    }
    return null;
  }

  private async findAnyByTarget(
    platform: ScmPlatform,
    target: { owner: string; repo: string | null },
  ): Promise<{ id: string; webhookSecretCiphertext: string | null } | null> {
    const res = await query<{ id: string; webhook_secret_ciphertext: string | null }>(
      `SELECT id, webhook_secret_ciphertext
       FROM integrations
       WHERE platform = $1
         AND target_owner = $2
         AND COALESCE(target_repo, '') = COALESCE($3, '')
         AND status = 'connected'
       LIMIT 1`,
      [platform, target.owner, target.repo],
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return { id: r.id, webhookSecretCiphertext: r.webhook_secret_ciphertext };
  }

  private async log(
    platform: ScmPlatform,
    verified: boolean,
    deliveryId: string | null,
    eventType: string | null,
    reason: string | null,
    published = false,
  ): Promise<void> {
    await query(
      `INSERT INTO webhook_events (id, platform, delivery_id, event_type, verified, published, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), platform, deliveryId, eventType, verified, published, reason],
    );
  }
}
