/**
 * GitLabWebhookVerifier
 * -----------------------------------------------------------------------------
 * GitLab does NOT sign the payload with HMAC. Instead, at hook creation time
 * you supply a `token` value, and GitLab echoes it back on every delivery in
 * the `X-Gitlab-Token` header (verbatim, no hashing). We compare it in
 * constant time to the secret we stored.
 *
 * This has two implications relative to GitHub:
 *   1. The secret goes over the wire on every delivery. TLS is doing 100% of
 *      the confidentiality lifting — never expose your ingest endpoint over
 *      plain HTTP.
 *   2. There's no per-request integrity check on the body. A tampering
 *      man-in-the-middle attacker who defeats TLS could alter fields. We
 *      still parse defensively and re-validate against the stored target
 *      before actioning anything (see WebhookIngressService).
 *
 * Docs: https://docs.gitlab.com/user/project/integrations/webhooks/#validate-payloads-by-using-a-secret-token
 */

import { timingSafeEqual } from "node:crypto";
import type {
  IWebhookVerifier,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from "../../domain/interfaces/IWebhookVerifier.js";

export class GitLabWebhookVerifier implements IWebhookVerifier {
  readonly platform = "gitlab" as const;

  verify(input: WebhookVerificationInput): WebhookVerificationResult {
    const provided = input.headers["x-gitlab-token"];
    if (!provided) return { ok: false, reason: "missing X-Gitlab-Token" };

    const a = Buffer.from(provided);
    const b = Buffer.from(input.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "token mismatch" };
    }
    return {
      ok: true,
      eventType: input.headers["x-gitlab-event"],
      deliveryId: input.headers["x-gitlab-event-uuid"],
    };
  }
}
