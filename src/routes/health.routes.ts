/**
 * Health & readiness routes. Kept outside internal-auth so k8s probes and
 * docker-compose healthchecks can hit them without needing the API key.
 */

import type { FastifyPluginAsync } from "fastify";
import { query } from "../persistence/db.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness — process is up. No dependencies.
  app.get("/healthz", async () => ({ status: "ok" }));

  // Readiness — dependencies (Postgres) are reachable.
  app.get("/readyz", async (_req, reply) => {
    try {
      await query("SELECT 1");
      return { status: "ready" };
    } catch (err) {
      reply.code(503);
      return {
        status: "not_ready",
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });
};
