-- =============================================================================
-- Integration Service — schema
-- =============================================================================
-- We intentionally keep this simple (no ORM). In production, run this through
-- a proper migration tool (node-pg-migrate, Prisma migrate, Flyway…) so you
-- get version tracking. For local dev, `psql -f migrations.sql` is fine.

CREATE TABLE IF NOT EXISTS integrations (
  id                          UUID          PRIMARY KEY,
  owner_user_id               TEXT          NOT NULL,
  platform                    TEXT          NOT NULL CHECK (platform IN ('github','gitlab')),
  target_kind                 TEXT          NOT NULL CHECK (target_kind IN ('repository','organization')),
  target_owner                TEXT          NOT NULL,
  target_repo                 TEXT,
  external_user_id            TEXT          NOT NULL,
  external_user_login         TEXT          NOT NULL,
  webhook_external_id         TEXT,
  -- Webhook secret, encrypted (opaque to Postgres).
  webhook_secret_ciphertext   TEXT,
  status                      TEXT          NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('pending','authorized','connected','revoked','error')),
  last_error                  TEXT,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One authorized connection per (owner, platform, target) — prevents dup
-- webhooks pointing at us for the same repo.
CREATE UNIQUE INDEX IF NOT EXISTS integrations_owner_target_uq
  ON integrations (owner_user_id, platform, target_owner, COALESCE(target_repo, ''));

-- OAuth tokens are kept in their own table so we can rotate them and delete
-- them independently of the integration record (e.g. on revoke we blank the
-- token but keep the integration row for audit).
CREATE TABLE IF NOT EXISTS integration_tokens (
  integration_id              UUID          PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  platform                    TEXT          NOT NULL,
  ciphertext                  TEXT          NOT NULL,   -- encrypted access token
  refresh_ciphertext          TEXT,                     -- encrypted refresh token
  scope                       TEXT          NOT NULL,
  access_token_expires_at     TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Simple audit log — useful for FR-03.4 ("log webhook receipt, validation
-- results, publishing status, and processing failures").
CREATE TABLE IF NOT EXISTS webhook_events (
  id                          UUID          PRIMARY KEY,
  platform                    TEXT          NOT NULL,
  delivery_id                 TEXT,
  event_type                  TEXT,
  received_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  verified                    BOOLEAN       NOT NULL,
  published                   BOOLEAN       NOT NULL DEFAULT FALSE,
  failure_reason              TEXT
);

CREATE INDEX IF NOT EXISTS webhook_events_platform_received_idx
  ON webhook_events (platform, received_at DESC);
