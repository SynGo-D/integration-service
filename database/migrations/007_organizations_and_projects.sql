-- Migration: 007_organizations_and_projects
-- Turns the platform multi-tenant: organizations, members with roles, and
-- projects that group repositories.
--
-- Until now a connected repository belonged to one user, and every user saw
-- their own list. A team can't work that way: the repositories belong to the
-- organization, several people need access with different rights, and a
-- product is usually several repositories ("Checkout" = an API and a web
-- app), which is what a project is here.
--
-- Design decisions:
--   • Organizations own everything. A repository's integration now carries
--     organization_id, so access is decided by membership, not by who
--     happened to click "connect".
--   • Roles live on the membership, not on the user: the same person can be
--     an admin of one organization and a developer in another.
--       ADMIN     — manage the organization, its members and its projects
--       MANAGER   — everything a developer can do, plus edit business rules
--       DEVELOPER — read analyses and rate AI review issues
--   • project_id on integrations is nullable: a repository can be connected
--     before it's filed under a project, and stays usable meanwhile.
--   • Deleting an organization removes its projects and integrations
--     (CASCADE); deleting a project only unfiles its repositories
--     (SET NULL), because the connection and its webhook are still valid.
--   • Existing rows are migrated: every user who connected something gets
--     their own organization (as its ADMIN) with a "Default" project
--     holding those repositories. Nothing is left unreachable.

CREATE TABLE IF NOT EXISTS organizations (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(120) NOT NULL,

    -- Used in URLs and to identify the organization to people. Unique
    -- platform-wide, like a GitHub org name.
    slug VARCHAR(60) UNIQUE NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);


CREATE TABLE IF NOT EXISTS organization_members (

    organization_id UUID NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    role VARCHAR(20) NOT NULL
        CHECK (role IN ('ADMIN', 'MANAGER', 'DEVELOPER')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

    PRIMARY KEY (organization_id, user_id)
);

-- "Which organizations am I in?" runs on every request that resolves a
-- caller's rights, so it gets its own index.
CREATE INDEX IF NOT EXISTS idx_organization_members_user
    ON organization_members (user_id);


CREATE TABLE IF NOT EXISTS projects (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(120) NOT NULL,

    -- Unique within the organization, not globally: two organizations may
    -- each have a "checkout" project.
    slug VARCHAR(60) NOT NULL,

    description TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,

    UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_organization
    ON projects (organization_id);


ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS organization_id UUID
        REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_integrations_organization
    ON integrations (organization_id);

CREATE INDEX IF NOT EXISTS idx_integrations_project
    ON integrations (project_id);


-- ---------------------------------------------------------------------------
-- Migrate what exists: one organization per user who already has data, with
-- that user as its ADMIN and a "Default" project holding their repositories.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    existing_user  RECORD;
    new_org_id     UUID;
    new_project_id UUID;
    org_slug       TEXT;
BEGIN
    FOR existing_user IN
        SELECT DISTINCT u.id, u.email, u.full_name
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM organization_members m WHERE m.user_id = u.id
        )
    LOOP
        -- A readable slug from the email's local part, with anything that
        -- doesn't belong in a URL removed, plus a short suffix so two
        -- "developer@..." addresses from different domains can't collide.
        org_slug := left(
            regexp_replace(lower(split_part(existing_user.email, '@', 1)), '[^a-z0-9]+', '-', 'g'),
            40
        ) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 6);

        INSERT INTO organizations (name, slug)
        VALUES (coalesce(nullif(existing_user.full_name, ''), existing_user.email) || '''s Organization', org_slug)
        RETURNING id INTO new_org_id;

        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (new_org_id, existing_user.id, 'ADMIN');

        INSERT INTO projects (organization_id, name, slug, description)
        VALUES (new_org_id, 'Default', 'default', 'Repositories connected before projects existed.')
        RETURNING id INTO new_project_id;

        UPDATE integrations
        SET organization_id = new_org_id,
            project_id      = new_project_id,
            updated_at      = NOW()
        WHERE user_id = existing_user.id
          AND organization_id IS NULL;
    END LOOP;
END $$;
