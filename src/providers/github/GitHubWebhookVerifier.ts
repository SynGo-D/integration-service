/**
 * GitHubWebhookVerifier
 * -----------------------------------------------------------------------------
 * GitHub signs every webhook delivery with HMAC-SHA256 of the raw request
 * body using the secret we supplied at hook creation time, and puts the
 * hex digest in the `X-Hub-Signature-256` header prefixed with `sha256=`.
 *
 * The comparison MUST be:
 *   - performed on the RAW body bytes (before JSON parse, before any
 *     transformation) — mismatch by even one whitespace character = 401.
 *   - constant-time, so response time doesn't leak the correct signature.
 *
 * Docs: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  IWebhookVerifier,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from "../../domain/interfaces/IWebhookVerifier.js";

export class GitHubWebhookVerifier implements IWebhookVerifier {
  readonly platform = "github" as const;

  verify(input: WebhookVerificationInput): WebhookVerificationResult {
    const sigHeader = input.headers["x-hub-signature-256"];
    if (!sigHeader || !sigHeader.startsWith("sha256=")) {
      return { ok: false, reason: "missing X-Hub-Signature-256" };
    }
    const provided = Buffer.from(sigHeader.slice("sha256=".length), "hex");
    const expected = createHmac("sha256", input.secret).update(input.rawBody).digest();

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return {
      ok: true,
      eventType: input.headers["x-github-event"],
      deliveryId: input.headers["x-github-delivery"],
    };
  }
}
