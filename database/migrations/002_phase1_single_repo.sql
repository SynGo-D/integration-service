-- Migration: 002_phase1_single_repo
-- Adds the integrations table for Phase 1 single-repository connections.
--
-- Design decisions:
--   • repository_url / owner / name stored so the record is self-contained
--     without a JOIN to connected_resources.
--   • status PENDING → ACTIVE flow: the row is created when the user clicks
--     "Authorize" (preview confirmed) and promoted to ACTIVE after OAuth.
--   • Tokens are stored encrypted (AES-256-GCM) at the application layer;
--     the DB column is plain TEXT because decryption happens in code.
--   • Unique index on (user_id, provider, owner, name) WHERE status != 'REVOKED'
--     prevents duplicate active connections to the same repository per user.
--   • Nullable provider_user_id / provider_username: populated at OAuth completion.
--   • Schema is forward-compatible: organization_id, webhook columns can be added
--     later without changing this table's core structure.

-- -------------------------------------------------------
-- Integrations
-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS integrations (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Platform user who owns this connection
    user_id UUID NOT NULL,

    -- Source control provider
    provider VARCHAR(20) NOT NULL
        CHECK (provider IN ('github', 'gitlab')),

    -- Repository coordinates
    repository_url TEXT NOT NULL,

    repository_owner VARCHAR(255) NOT NULL,

    repository_name VARCHAR(255) NOT NULL,

    -- Encrypted access token (AES-256-GCM, base64-encoded)
    access_token TEXT NOT NULL,

    -- Optional refresh token (some providers support rotation)
    refresh_token TEXT,

    -- When the access token expires (NULL = does not expire)
    token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Provider identity, populated after OAuth completes
    provider_user_id VARCHAR(255),

    provider_username VARCHAR(255),

    -- Lifecycle status
    -- PENDING  – user has confirmed preview; OAuth not yet complete
    -- ACTIVE   – OAuth complete; tokens stored; repository connected
    -- EXPIRED  – access token has expired and could not be refreshed
    -- REVOKED  – user disconnected the repository
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED')),

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP NOT NULL,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP NOT NULL,

    -- Referential integrity: cascade-delete integrations when the user is removed
    CONSTRAINT fk_integration_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);


-- Index for common query: all integrations belonging to a user
CREATE INDEX IF NOT EXISTS idx_integrations_user
    ON integrations (user_id);


-- Prevent a user from having two active connections to the same repository
-- on the same provider. REVOKED rows are excluded so re-connecting is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_user_repo_unique
    ON integrations (user_id, provider, repository_owner, repository_name)
    WHERE status != 'REVOKED';
