-- Migration: Integration Service initial schema
-- SynGo Integration Service database


CREATE EXTENSION IF NOT EXISTS "pgcrypto";


----------------------------------------------------
-- Application Users
----------------------------------------------------

CREATE TABLE users (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email VARCHAR(255) UNIQUE NOT NULL,

    full_name VARCHAR(255) NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP
        NOT NULL,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP
        NOT NULL
);



----------------------------------------------------
-- External Source Control Connections
----------------------------------------------------

CREATE TABLE source_control_connections (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL,

    provider VARCHAR(20) NOT NULL
        CHECK(provider IN ('github','gitlab')),

    provider_user_id VARCHAR(255) NOT NULL,

    provider_username VARCHAR(255) NOT NULL,

    access_token TEXT NOT NULL,

    refresh_token TEXT,

    expires_at TIMESTAMP WITH TIME ZONE,

    status VARCHAR(20) NOT NULL
        CHECK(status IN ('ACTIVE','EXPIRED','REVOKED')),

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT fk_connection_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);



CREATE INDEX idx_source_connection_user
ON source_control_connections(user_id);



----------------------------------------------------
-- Connected Provider Resources
----------------------------------------------------

CREATE TABLE connected_resources (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    connection_id UUID NOT NULL,

    provider_resource_id VARCHAR(255) NOT NULL,

    resource_type VARCHAR(30) NOT NULL
        CHECK(resource_type IN ('ORGANIZATION','REPOSITORY')),

    parent_resource_id UUID,

    name VARCHAR(255) NOT NULL,

    full_name VARCHAR(500),

    description TEXT,

    owner_name VARCHAR(255),

    visibility VARCHAR(20),

    default_branch VARCHAR(100),

    is_archived BOOLEAN DEFAULT FALSE,

    web_url TEXT,

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT fk_resource_connection
        FOREIGN KEY(connection_id)
        REFERENCES source_control_connections(id)
        ON DELETE CASCADE,


    CONSTRAINT fk_parent_resource
        FOREIGN KEY(parent_resource_id)
        REFERENCES connected_resources(id)
);



CREATE INDEX idx_resources_connection
ON connected_resources(connection_id);



----------------------------------------------------
-- Managed Repositories
----------------------------------------------------

CREATE TABLE managed_repositories (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    resource_id UUID NOT NULL UNIQUE,

    analysis_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    quality_gate_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    last_synced_at TIMESTAMP WITH TIME ZONE,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE','DISABLED','ARCHIVED')),

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT fk_managed_resource
        FOREIGN KEY(resource_id)
        REFERENCES connected_resources(id)
        ON DELETE CASCADE
);



----------------------------------------------------
-- Repository Webhooks
----------------------------------------------------

CREATE TABLE webhooks (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    managed_repository_id UUID NOT NULL UNIQUE,

    provider_webhook_id VARCHAR(255),

    secret_hash TEXT NOT NULL,

    events TEXT[] NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK(status IN ('ACTIVE','INACTIVE')),

    last_delivery_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,


    CONSTRAINT fk_webhook_repository
        FOREIGN KEY(managed_repository_id)
        REFERENCES managed_repositories(id)
        ON DELETE CASCADE
);