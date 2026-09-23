-- Migration: 008_user_passwords
-- Gives users a password, so signing in is a real check rather than a claim.
--
-- Until now "logging in" meant posting an email address: the service looked
-- it up, created it if it was new, and issued a session. Anyone who knew a
-- colleague's address could sign in as them and read their organization's
-- reviews. Multi-tenancy (007) decides *what* a user may see; this decides
-- *that they are that user*.
--
-- Design decisions:
--   • Nullable on purpose. An admin adds a member by email before that
--     person has ever visited (OrganizationService.addMember), and rows
--     created that way have no password yet. They set one by registering
--     with the same address, which keeps the memberships already granted to
--     them. A NULL hash therefore means "account exists, no password set",
--     and authentication always fails against it.
--   • The hash — never the password — is stored, in the self-describing
--     format written by utils/password.ts (scrypt, with its parameters and
--     salt inside the string) so the cost can be raised later without
--     invalidating existing hashes.
--   • Kept in the users table rather than a separate credentials table:
--     there is exactly one credential per user today, and a join would add
--     nothing but a chance to forget it.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

COMMENT ON COLUMN users.password_hash IS
    'scrypt hash written by utils/password.ts. NULL means the account was created by an admin and has no password yet.';
