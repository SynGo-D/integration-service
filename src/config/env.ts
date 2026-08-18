/**
 * Env config
 * -----------------------------------------------------------------------------
 * All process.env access happens HERE. Everywhere else in the code we pass
 * config objects, which makes the code:
 *   - Testable (no env pollution in unit tests).
 *   - Fail-fast (missing/malformed vars crash the process at boot, not on
 *     first request three days later).
 *
 * We use Zod because it composes well and gives clear error messages.
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4001),

  DATABASE_URL: z.string().min(1),

  // 32-byte key base64-encoded. See TokenEncryptor for how to generate.
  TOKEN_ENC_KEY_BASE64: z.string().min(1),

  // >= 32 chars random. HMAC key used to sign OAuth state.
  OAUTH_STATE_SECRET: z.string().min(32),

  // Shared secret with the main backend.
  INTERNAL_API_KEY: z.string().min(16),

  // Public base URL of THIS service (integration-service), used to build
  // webhook delivery URLs. In dev with docker-compose this is typically
  // http://localhost:4001 exposed via ngrok/localtunnel/cloudflared so
  // GitHub can reach us.
  PUBLIC_BASE_URL: z.string().url(),

  // GitHub OAuth app credentials.
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),

  // GitLab OAuth app credentials.
  GITLAB_CLIENT_ID: z.string().min(1),
  GITLAB_CLIENT_SECRET: z.string().min(1),
  GITLAB_HOST_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.format());
    throw new Error("Environment validation failed");
  }
  return parsed.data;
}
