/**
 * InternalAuth
 * -----------------------------------------------------------------------------
 * The integration service is NOT meant to be reachable by end users. The
 * frontend calls the Main Backend; the Main Backend calls the integration
 * service over the internal network. To enforce that boundary in code (even
 * if the network layer is misconfigured) we require every internal request
 * to carry a shared secret in a header:
 *
 *     X-Internal-Api-Key: <secret>
 *
 * The secret lives in env INTERNAL_API_KEY on both sides. In production it
 * should be provisioned from your secret manager and rotated on a schedule.
 *
 * Exception: the /webhooks/* routes must remain publicly reachable (that's
 * where GitHub & GitLab POST events). Those routes deliberately do NOT
 * apply this check — they authenticate incoming requests via HMAC signature
 * verification instead (see IWebhookVerifier implementations).
 *
 * Constant-time comparison prevents timing side-channel attacks on the key.
 *
 * SOLID: SRP — one concern (does this request carry a valid internal key).
 * Fastify-agnostic core (`isAuthorized`) is unit-testable; the plugin
 * factory just wires it to Fastify preHandler hooks.
 */

import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { InternalAuthFailedError } from "../domain/errors/index.js";

export function isAuthorized(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Fastify plugin that applies internal-auth to every route registered under
 * the encapsulation context. Register it inside the scope that groups your
 * internal-only routes; keep webhook routes OUTSIDE this scope.
 */
export const internalAuthPlugin: FastifyPluginCallback<{ apiKey: string }> = (
  fastify,
  opts,
  done,
) => {
  fastify.addHook("preHandler", async (req: FastifyRequest) => {
    const header = req.headers["x-internal-api-key"];
    const value = Array.isArray(header) ? header[0] : header;
    if (!isAuthorized(value, opts.apiKey)) {
      throw new InternalAuthFailedError("Missing or invalid X-Internal-Api-Key");
    }
  });
  done();
};
