-- Migration: 004_oauth_nonce
-- Makes the OAuth CSRF nonce real.
--
-- Before this migration, IntegrationService generated a random nonce, encoded
-- it into the `state` parameter, and on callback checked only that *some*
-- nonce was present. The value was never stored, so there was nothing to
-- compare against — and because `state` is plain base64url (unsigned), anyone
-- could craft `{integrationId, provider, nonce: "anything"}` and submit a
-- forged callback. The nonce was decoration.
--
-- Design decisions:
--   • Stored on the integration row rather than HMAC-signing the state.
--     The PENDING row already exists before the redirect (it's how the
--     callback is correlated to a repository), so it's the natural home —
--     and clearing the column on use gives genuine one-time semantics.
--     A signed-but-stateless state would still be replayable until expiry.
--   • Both columns are nullable and cleared on consumption: a NULL
--     oauth_nonce means "this flow has already been completed", which is
--     what makes a replayed callback fail.
--   • oauth_expires_at bounds an abandoned flow. OAuth authorization is a
--     few seconds of user interaction; 10 minutes is generous.
--   • VARCHAR(64) fits the 32-character hex nonce (16 random bytes) with
--     room to widen the nonce later without another migration.

ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS oauth_nonce VARCHAR(64),
    ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMP WITH TIME ZONE;
