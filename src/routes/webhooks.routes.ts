/**
 * /webhooks routes — PUBLIC endpoints
 * -----------------------------------------------------------------------------
 * These routes MUST remain reachable without the X-Internal-Api-Key header,
 * because GitHub/GitLab are the callers. They are protected instead by HMAC
 * signature verification (see IWebhookVerifier impls).
 *
 * The route registers a rawBody parser so we can compute the HMAC over the
 * exact bytes received. Fastify by default parses JSON and DISCARDS the
 * original bytes, which would break signature verification.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { WebhookIngressService } from "../services/WebhookIngressService.js";
import { DomainError } from "../domain/errors/index.js";

const PlatformParam = z.object({ platform: z.enum(["github", "gitlab"]) });

export function webhookRoutes(deps: {
  ingress: WebhookIngressService;
}): FastifyPluginAsync {
  return async (app) => {
    // Register a raw-buffer content parser so we get req.rawBody intact.
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => {
        // We MUST keep the raw bytes for HMAC. We also parse for downstream
        // convenience, but the raw buffer is what the verifier uses.
        try {
          const text = (body as Buffer).toString("utf8");
          const parsed = text.length ? JSON.parse(text) : {};
          done(null, { __raw: body, parsed });
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    app.post("/:platform", async (req, reply) => {
      const params = PlatformParam.safeParse(req.params);
      if (!params.success) {
        reply.code(404);
        return { code: "unknown_platform" };
      }
      const b = req.body as { __raw?: Buffer } | undefined;
      const raw = b?.__raw ?? Buffer.alloc(0);

      // Normalize header casing to lowercase for the verifier.
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : (v as string | undefined);
      }

      try {
        const result = await deps.ingress.ingest({
          platform: params.data.platform,
          rawBody: raw,
          headers,
        });
        // Return fast (FR-03.4). Downstream processing is async via the queue.
        reply.code(202);
        return { accepted: result.accepted, deliveryId: result.deliveryId };
      } catch (err) {
        if (err instanceof DomainError) {
          reply.code(err.httpStatus);
          return { code: err.code, message: err.message };
        }
        reply.code(500);
        return {
          code: "internal_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    });
  };
}
