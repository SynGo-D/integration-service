/**
 * Integration Service — application bootstrap
 * -----------------------------------------------------------------------------
 * The COMPOSITION ROOT — the one place where all concrete classes are
 * instantiated and wired together. Everywhere else works with interfaces.
 *
 * This layout means:
 *   - Swapping Postgres for SQLite in tests = change 3 lines here.
 *   - Adding a new SCM provider = register it in the factory, done.
 *   - Adding a message queue = swap NoopPublisher for RabbitMQPublisher,
 *     one line change.
 */

import Fastify from "fastify";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./utils/logger.js";
import { initPool } from "./persistence/db.js";
import { PostgresTokenStore } from "./persistence/TokenStore.js";
import { PostgresIntegrationRepository } from "./persistence/IntegrationRepository.js";
import { TokenEncryptor } from "./security/TokenEncryptor.js";
import { StateSigner } from "./security/StateSigner.js";
import { internalAuthPlugin } from "./security/InternalAuth.js";
import { ProviderFactory } from "./providers/ProviderFactory.js";
import { RepositoryPreviewService } from "./services/RepositoryPreviewService.js";
import { OAuthOrchestrator } from "./services/OAuthOrchestrator.js";
import { RepositoryConnectService } from "./services/RepositoryConnectService.js";
import {
  WebhookIngressService,
  NoopPublisher,
} from "./services/WebhookIngressService.js";
import { healthRoutes } from "./routes/health.routes.js";
import { reposRoutes } from "./routes/repos.routes.js";
import { oauthRoutes } from "./routes/oauth.routes.js";
import { webhookRoutes } from "./routes/webhooks.routes.js";

async function main() {
  const env = loadEnv();
  const log = createLogger("integration-service");

  // ---------- infra ----------
  initPool({ connectionString: env.DATABASE_URL });

  // ---------- security ----------
  const encryptor = new TokenEncryptor(env.TOKEN_ENC_KEY_BASE64);
  const stateSigner = new StateSigner(env.OAUTH_STATE_SECRET);

  // ---------- providers ----------
  const factory = new ProviderFactory({
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    gitlab: {
      clientId: env.GITLAB_CLIENT_ID,
      clientSecret: env.GITLAB_CLIENT_SECRET,
      hostUrl: env.GITLAB_HOST_URL,
    },
  });

  // ---------- persistence adapters ----------
  const integrationRepo = new PostgresIntegrationRepository();
  const tokenStore = new PostgresTokenStore();

  // ---------- application services ----------
  const previewService = new RepositoryPreviewService(factory);
  const oauthOrchestrator = new OAuthOrchestrator(
    factory,
    stateSigner,
    encryptor,
    integrationRepo,
    tokenStore,
  );
  const connectService = new RepositoryConnectService(
    factory,
    encryptor,
    integrationRepo,
    tokenStore,
  );
  const publisher = new NoopPublisher(); // swap for RabbitMQPublisher later
  const ingressService = new WebhookIngressService(
    factory,
    encryptor,
    integrationRepo,
    publisher,
  );

  // ---------- HTTP ----------
  const app = Fastify({ logger: false });

  // Public routes (health + webhook ingress).
  await app.register(healthRoutes);
  await app.register(webhookRoutes({ ingress: ingressService }), {
    prefix: "/webhooks",
  });

  // Internal routes — behind X-Internal-Api-Key.
  await app.register(async (internal) => {
    await internal.register(internalAuthPlugin, { apiKey: env.INTERNAL_API_KEY });
    await internal.register(reposRoutes({ previewService, connectService }), {
      prefix: "/repos",
    });
    await internal.register(oauthRoutes({ orchestrator: oauthOrchestrator }), {
      prefix: "/oauth",
    });
  });

  // Uniform error hook — turn anything unhandled into a JSON body.
  app.setErrorHandler((err, _req, reply) => {
    log.error("unhandled error", { err: err.message, stack: err.stack });
    reply.code(reply.statusCode >= 400 ? reply.statusCode : 500);
    reply.send({ code: "internal_error", message: err.message });
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  log.info(`integration-service listening on ${env.PORT}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start integration-service:", err);
  process.exit(1);
});
