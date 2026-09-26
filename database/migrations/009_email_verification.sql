-- Migration: 009_email_verification
-- Records whether an email address has actually been proven.
--
-- The column exists before the flow that sets it, on purpose. Joining an
-- organization by email domain — anyone at routeright.com becomes a member
-- of RouteRight — is only safe if the address was proven, otherwise
-- registering as someone@routeright.com is all it takes to get in. Adding
-- the column now means that rule can be written against a real field
-- rather than retrofitted later, and it is what the seeded demo accounts
-- set honestly: the platform created them, so nothing needs proving.
--
-- Design decisions:
--   • Existing rows are backfilled to TRUE. They belong to people already
--     using the platform, and defaulting them to FALSE would mean marking
--     real users unverified for a flow that does not exist yet.
--   • New rows default to FALSE, which is the correct starting point once
--     registration can send a verification email.
--   • Login is deliberately NOT gated on this yet. Gating it before the
--     verification flow exists would lock out every account that cannot
--     yet prove itself — including the three real ones in production.
--     The gate belongs with the flow, in one change, so the two cannot be
--     deployed apart.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE;

COMMENT ON COLUMN users.email_verified IS
    'Whether this address was proven. Required before domain-based organization membership may apply. Seeded accounts are true by construction.';
