/**
 * IWebhookVerifier
 * -----------------------------------------------------------------------------
 * A tiny interface — deliberately. GitHub and GitLab verify webhook signatures
 * in quite different ways (GitHub: HMAC-SHA256 over the raw body compared
 * against `X-Hub-Signature-256`; GitLab: constant-time compare of `X-Gitlab-Token`
 * against the stored secret). We hide that difference behind ONE method so the
 * webhook ingress route can be provider-agnostic (FR-03.1 "verify the
 * authenticity of each request using the platform's HMAC signature verification
 * mechanism").
 *
 * Kept separate from IScmProvider because:
 *   - ISP: the ingest route needs ONLY verification, not OAuth/registration.
 *   - SRP: HMAC comparison is a self-contained concern.
 */

import type { ScmPlatform } from "./IScmProvider.js";

export interface WebhookVerificationInput {
  /** Raw request body — MUST be the exact bytes received, before JSON parsing. */
  rawBody: Buffer;
  /** Case-insensitive lookup of request headers. */
  headers: Record<string, string | undefined>;
  /** The shared secret we generated when we registered this webhook. */
  secret: string;
}

export interface WebhookVerificationResult {
  ok: boolean;
  /** Populated on failure — safe to log, does NOT contain the secret. */
  reason?: string;
  /** Detected event type as reported by the platform, if any. */
  eventType?: string;
  /** Delivery id as reported by the platform, if any (useful for de-dup). */
  deliveryId?: string;
}

export interface IWebhookVerifier {
  readonly platform: ScmPlatform;
  verify(input: WebhookVerificationInput): WebhookVerificationResult;
}
