-- Migration: 003_webhook_registration
-- Adds webhook tracking columns to `integrations`, so a repository webhook
-- can be registered automatically when OAuth completes (instead of the user
-- manually creating one in GitHub/GitLab's settings UI), and cleanly removed
-- again when the integration is revoked.
--
-- Design decisions:
--   • provider_webhook_id is nullable: registration is best-effort (see
--     IntegrationService.handleOAuthCallback) — a repository stays
--     successfully connected even if webhook creation fails (e.g. insufficient
--     permissions, provider outage), so this column simply reflects whether
--     it happened, not whether the integration itself is valid.
--   • No separate `webhooks` table (the schema already has an unused one
--     scaffolded via Webhook.ts/WebhookRepository.ts for a future multi-hook
--     design) — Phase 1 is one repository per integration, so one webhook
--     per integration row is sufficient and avoids a needless join.

ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS provider_webhook_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS webhook_registered_at TIMESTAMP WITH TIME ZONE;
