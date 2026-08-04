
CREATE TABLE source_control_connections (

    id UUID PRIMARY KEY,

    provider VARCHAR(20) NOT NULL,

    provider_user_id VARCHAR(255) NOT NULL,

    provider_username VARCHAR(255) NOT NULL,

    access_token TEXT NOT NULL,

    refresh_token TEXT,

    expires_at TIMESTAMP,

    status VARCHAR(20) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

);
CREATE TABLE webhooks (

    id UUID PRIMARY KEY,

    managed_repository_id UUID NOT NULL UNIQUE,

    provider_webhook_id VARCHAR(255),

    secret_hash TEXT NOT NULL,

    events TEXT[] NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    last_delivery_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_webhook_repository
        FOREIGN KEY (managed_repository_id)
        REFERENCES managed_repositories(id)
        ON DELETE CASCADE

);

CREATE TABLE connected_resources (

    id UUID PRIMARY KEY,

    connection_id UUID NOT NULL,

    provider_resource_id VARCHAR(255) NOT NULL,

    resource_type VARCHAR(30) NOT NULL,

    parent_resource_id UUID,

    name VARCHAR(255) NOT NULL,

    full_name VARCHAR(500),

    description TEXT,

    owner_name VARCHAR(255),

    visibility VARCHAR(20),

    default_branch VARCHAR(100),

    is_archived BOOLEAN DEFAULT FALSE,

    web_url TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_connection
        FOREIGN KEY (connection_id)
        REFERENCES source_control_connections(id),

    CONSTRAINT fk_parent_resource
        FOREIGN KEY (parent_resource_id)
        REFERENCES connected_resources(id)

);

CREATE TABLE managed_repositories (

    id UUID PRIMARY KEY,

    resource_id UUID NOT NULL UNIQUE,

    analysis_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    quality_gate_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    last_synced_at TIMESTAMP,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_managed_resource
        FOREIGN KEY (resource_id)
        REFERENCES connected_resources(id)
        ON DELETE CASCADE

);

-- Source Control Connections
CREATE TABLE source_control_connections (
    ...
);


-- Connected Resources
CREATE TABLE connected_resources (
    ...
);

-- Constraints
ALTER TABLE source_control_connections
ADD CONSTRAINT chk_provider
CHECK (provider IN ('github', 'gitlab'));

ALTER TABLE connected_resources
ADD CONSTRAINT chk_resource_type
CHECK (
    resource_type IN (
        'repository',
        'organization',
        'project',
        'group'
    )
);

ALTER TABLE connected_resources
ADD CONSTRAINT chk_visibility
CHECK (
    visibility IN (
        'public',
        'private',
        'internal'
    )
);

ALTER TABLE managed_repositories
ADD CONSTRAINT chk_repository_status
CHECK (
    status IN (
        'ACTIVE',
        'DISABLED',
        'ARCHIVED'
    )
);

ALTER TABLE webhooks
ADD CONSTRAINT chk_webhook_status
CHECK (
    status IN (
        'ACTIVE',
        'DISABLED',
        'FAILED'
    )
);

-- Indexes

CREATE INDEX idx_connection
ON connected_resources(connection_id);

CREATE INDEX idx_provider_resource
ON connected_resources(provider_resource_id);

CREATE INDEX idx_parent
ON connected_resources(parent_resource_id);

CREATE INDEX idx_managed_resource
ON managed_repositories(resource_id);

CREATE INDEX idx_webhook_repository
ON webhooks(managed_repository_id);


