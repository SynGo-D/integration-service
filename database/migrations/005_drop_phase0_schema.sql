-- Migration: 005_drop_phase0_schema
-- Removes the original multi-repository schema, superseded by `integrations`.
--
-- Migration 001 modelled connecting a whole account: a user held
-- source_control_connections, each exposing connected_resources (orgs and
-- repos), of which some became managed_repositories, each with its own
-- webhooks row. Migration 002 replaced all of it with the far simpler
-- Phase 1 design — one `integrations` row per connected repository, with
-- the webhook recorded inline (see 003).
--
-- Those four tables have been carried unused ever since: every one of them
-- holds zero rows, and the repository/model classes that read them
-- (ConnectedResourceRepository, ManagedRepositoryRepository,
-- OrganizationRepository, RepositoryRepository,
-- SourceControlConnectionRepository, WebhookRepository) were referenced by
-- nothing and are deleted in the same change. Leaving them in place meant
-- every reader of this service had to work out for themselves which of two
-- data models was the real one.
--
-- If multi-repository support returns, it should be designed against what
-- Phase 1 actually learned rather than resurrected from a schema that was
-- never populated — the git history has it if needed.
--
-- Drop order follows the foreign keys:
--     webhooks -> managed_repositories -> connected_resources
--              -> source_control_connections -> users
-- `users` is NOT dropped; it is live and referenced by `integrations`.
--
-- No down migration, matching this project's existing migrations. Recreating
-- these tables means reinstating 001, which the reasoning above argues
-- against doing verbatim.

DROP TABLE IF EXISTS webhooks;
DROP TABLE IF EXISTS managed_repositories;
DROP TABLE IF EXISTS connected_resources;
DROP TABLE IF EXISTS source_control_connections;
