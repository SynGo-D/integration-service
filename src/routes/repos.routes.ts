/**
 * /repos routes
 * -----------------------------------------------------------------------------
 * These endpoints are internal (protected by X-Internal-Api-Key). The main
 * backend hits them on behalf of an authenticated user; the user id is
 * passed in the body/query so this service doesn't need its own session
 * cookies.
 *
 *   POST /repos/preview  { url }               → RepositoryPreview
 *   POST /repos/connect  { userId, integrationId, target, events? }
 *                                              → { integrationId, status, ... }
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RepositoryPreviewService } from "../services/RepositoryPreviewService.js";
import type { RepositoryConnectService } from "../services/RepositoryConnectService.js";
import { DomainError } from "../domain/errors/index.js";

const PreviewBody = z.object({
  url: z.string().url(),
});

const TargetSchema = z.object({
  platform: z.enum(["github", "gitlab"]),
  kind: z.enum(["repository", "organization"]),
  owner: z.string().min(1),
  repo: z.string().min(1).optional(),
  hostBaseUrl: z.string().url(),
});

const ConnectBody = z.object({
  userId: z.string().min(1),
  integrationId: z.string().uuid(),
  target: TargetSchema,
  deliveryUrl: z.string().url(),
  events: z.array(z.string()).optional(),
});

export function reposRoutes(deps: {
  previewService: RepositoryPreviewService;
  connectService: RepositoryConnectService;
}): FastifyPluginAsync {
  return async (app) => {
    app.post("/preview", async (req, reply) => {
      const parsed = PreviewBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { code: "validation_error", details: parsed.error.flatten() };
      }
      try {
        const preview = await deps.previewService.previewFromUrl(parsed.data.url);
        return { preview };
      } catch (err) {
        return handleDomain(err, reply);
      }
    });

    app.post("/connect", async (req, reply) => {
      const parsed = ConnectBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { code: "validation_error", details: parsed.error.flatten() };
      }
      try {
        const result = await deps.connectService.connect(parsed.data);
        return { integration: result };
      } catch (err) {
        return handleDomain(err, reply);
      }
    });
  };
}

function handleDomain(err: unknown, reply: import("fastify").FastifyReply) {
  if (err instanceof DomainError) {
    reply.code(err.httpStatus);
    return { code: err.code, message: err.message, details: err.details };
  }
  reply.code(500);
  return {
    code: "internal_error",
    message: err instanceof Error ? err.message : String(err),
  };
}
