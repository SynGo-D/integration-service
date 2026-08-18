/**
 * /oauth routes
 * -----------------------------------------------------------------------------
 *   POST /oauth/:platform/start     { userId, target?, returnTo?, redirectUri }
 *          → { authorizationUrl, state, expiresAt }
 *
 *   POST /oauth/:platform/complete  { userId, code, state, redirectUri }
 *          → { integrationId, externalUserLogin, returnTo? }
 *
 * Both are INTERNAL (main backend calls them). The main backend receives the
 * OAuth callback from the user's browser first, extracts code+state, then
 * calls /complete server-to-server. That keeps client_secret entirely inside
 * this service and lets the main backend do its own session bookkeeping.
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { OAuthOrchestrator } from "../services/OAuthOrchestrator.js";
import { DomainError } from "../domain/errors/index.js";

const PlatformParam = z.object({ platform: z.enum(["github", "gitlab"]) });

const StartBody = z.object({
  userId: z.string().min(1),
  target: z
    .object({
      platform: z.enum(["github", "gitlab"]),
      kind: z.enum(["repository", "organization"]),
      owner: z.string().min(1),
      repo: z.string().min(1).optional(),
      hostBaseUrl: z.string().url(),
    })
    .optional(),
  returnTo: z.string().optional(),
  redirectUri: z.string().url(),
});

const CompleteBody = z.object({
  userId: z.string().min(1),
  code: z.string().min(1),
  state: z.string().min(1),
  redirectUri: z.string().url(),
});

export function oauthRoutes(deps: {
  orchestrator: OAuthOrchestrator;
}): FastifyPluginAsync {
  return async (app) => {
    app.post("/:platform/start", async (req, reply) => {
      const params = PlatformParam.safeParse(req.params);
      const body = StartBody.safeParse(req.body);
      if (!params.success || !body.success) {
        reply.code(400);
        return {
          code: "validation_error",
          details: {
            params: params.success ? undefined : params.error.flatten(),
            body: body.success ? undefined : body.error.flatten(),
          },
        };
      }
      try {
        const req2 = deps.orchestrator.startAuthorization({
          userId: body.data.userId,
          platform: params.data.platform,
          target:
            body.data.target ?? {
              platform: params.data.platform,
              kind: "repository",
              owner: "",
              hostBaseUrl: params.data.platform === "github"
                ? "https://github.com"
                : "https://gitlab.com",
            },
          returnTo: body.data.returnTo,
          redirectUri: body.data.redirectUri,
        });
        return req2;
      } catch (err) {
        return handleDomain(err, reply);
      }
    });

    app.post("/:platform/complete", async (req, reply) => {
      const params = PlatformParam.safeParse(req.params);
      const body = CompleteBody.safeParse(req.body);
      if (!params.success || !body.success) {
        reply.code(400);
        return {
          code: "validation_error",
          details: {
            params: params.success ? undefined : params.error.flatten(),
            body: body.success ? undefined : body.error.flatten(),
          },
        };
      }
      try {
        const result = await deps.orchestrator.completeAuthorization({
          userId: body.data.userId,
          platform: params.data.platform,
          code: body.data.code,
          state: body.data.state,
          redirectUri: body.data.redirectUri,
        });
        return result;
      } catch (err) {
        return handleDomain(err, reply);
      }
    });
  };
}

function handleDomain(err: unknown, reply: import("fastify").FastifyReply) {
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
