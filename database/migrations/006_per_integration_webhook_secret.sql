-- Migration: 006_per_integration_webhook_secret
-- Gives every integration its own webhook secret.
--
-- Until now one GITHUB_WEBHOOK_SECRET (and one GITLAB_WEBHOOK_SECRET) signed
-- the hooks of every connected repository. Leaking it — and it has been
-- committed to this repository's history via .env — lets anyone forge a
-- delivery for *any* repository, and because webhook-listener checked only
-- the signature, it would queue analysis of whatever repository the forged
-- payload named.
--
-- Design decisions:
--   • Stored encrypted with the same AES-256-GCM scheme as the OAuth tokens
--     (utils/crypto.ts). It is exactly as sensitive: holding it is
--     sufficient to forge deliveries for that repository.
--   • Nullable. Integrations whose hook was registered before this change
--     were signed with the old shared secret; webhook-listener falls back to
--     it only for those rows (see the internal lookup endpoint), so existing
--     hooks keep working until they're reconnected.
--   • The index serves the lookup webhook-listener makes on every delivery:
--     active integrations for one provider + repository. Case-insensitive,
--     because GitHub repository names are, and the payload's casing need
--     not match what was stored from the URL the user pasted.

ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

CREATE INDEX IF NOT EXISTS idx_integrations_active_repo_lookup
    ON integrations (provider, lower(repository_owner), lower(repository_name))
    WHERE status = 'ACTIVE';
