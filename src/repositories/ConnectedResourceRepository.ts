// src/repositories/ConnectedResourceRepository.ts

import { pool } from "../config/database.js";
import { ConnectedResource } from "../models/ConnectedResource.js";

/**
 * Data-access layer for the `connected_resources` table.
 *
 * Connected resources represent repositories, organizations, projects, and
 * groups discovered from a source control provider connection.
 *
 * Phase 1 does not write directly to this table (Phase 1 stores repo info
 * on the `integrations` table).  This repository is preserved for
 * Phase 2+ where org-level sync populates connected_resources.
 */
export class ConnectedResourceRepository {

    private mapRow(row: any): ConnectedResource {
        return {
            id:                 row.id,
            connectionId:       row.connection_id,
            providerResourceId: row.provider_resource_id,
            resourceType:       row.resource_type,
            parentResourceId:   row.parent_resource_id ?? undefined,
            name:               row.name,
            fullName:           row.full_name     ?? undefined,
            description:        row.description   ?? undefined,
            ownerName:          row.owner_name    ?? undefined,
            visibility:         row.visibility,
            defaultBranch:      row.default_branch ?? undefined,
            isArchived:         row.is_archived,
            webUrl:             row.web_url        ?? undefined,
            createdAt:          new Date(row.created_at),
            updatedAt:          new Date(row.updated_at)
        };
    }

    async create(resource: ConnectedResource): Promise<ConnectedResource> {
        const query = `
            INSERT INTO connected_resources (
                id, connection_id, provider_resource_id, resource_type,
                parent_resource_id, name, full_name, description, owner_name,
                visibility, default_branch, is_archived, web_url
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *;
        `;

        const result = await pool.query(query, [
            resource.id,
            resource.connectionId,
            resource.providerResourceId,
            resource.resourceType,
            resource.parentResourceId ?? null,
            resource.name,
            resource.fullName         ?? null,
            resource.description      ?? null,
            resource.ownerName        ?? null,
            resource.visibility,
            resource.defaultBranch    ?? null,
            resource.isArchived,
            resource.webUrl           ?? null
        ]);

        return this.mapRow(result.rows[0]);
    }

    /** Bulk insert inside a single transaction. */
    async createMany(resources: ConnectedResource[]): Promise<ConnectedResource[]> {
        if (resources.length === 0) return [];

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const inserted: ConnectedResource[] = [];

            for (const resource of resources) {
                const result = await client.query(
                    `INSERT INTO connected_resources (
                        id, connection_id, provider_resource_id, resource_type,
                        parent_resource_id, name, full_name, description, owner_name,
                        visibility, default_branch, is_archived, web_url
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    RETURNING *;`,
                    [
                        resource.id,
                        resource.connectionId,
                        resource.providerResourceId,
                        resource.resourceType,
                        resource.parentResourceId ?? null,
                        resource.name,
                        resource.fullName         ?? null,
                        resource.description      ?? null,
                        resource.ownerName        ?? null,
                        resource.visibility,
                        resource.defaultBranch    ?? null,
                        resource.isArchived,
                        resource.webUrl           ?? null
                    ]
                );
                inserted.push(this.mapRow(result.rows[0]));
            }

            await client.query("COMMIT");
            return inserted;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async findById(id: string): Promise<ConnectedResource | null> {
        const result = await pool.query(
            `SELECT * FROM connected_resources WHERE id = $1;`,
            [id]
        );
        if (result.rows.length === 0) return null;
        return this.mapRow(result.rows[0]);
    }

    async findByProviderResourceId(
        connectionId:       string,
        providerResourceId: string
    ): Promise<ConnectedResource | null> {
        const result = await pool.query(
            `SELECT * FROM connected_resources
             WHERE connection_id = $1 AND provider_resource_id = $2;`,
            [connectionId, providerResourceId]
        );
        if (result.rows.length === 0) return null;
        return this.mapRow(result.rows[0]);
    }

    async findByConnection(connectionId: string): Promise<ConnectedResource[]> {
        const result = await pool.query(
            `SELECT * FROM connected_resources
             WHERE connection_id = $1
             ORDER BY resource_type, name;`,
            [connectionId]
        );
        return result.rows.map(row => this.mapRow(row));
    }

    async findChildren(parentResourceId: string): Promise<ConnectedResource[]> {
        const result = await pool.query(
            `SELECT * FROM connected_resources
             WHERE parent_resource_id = $1 AND is_archived = FALSE
             ORDER BY name;`,
            [parentResourceId]
        );
        return result.rows.map(row => this.mapRow(row));
    }

    async update(resource: ConnectedResource): Promise<ConnectedResource> {
        const result = await pool.query(
            `UPDATE connected_resources
             SET name           = $1,
                 full_name      = $2,
                 description    = $3,
                 owner_name     = $4,
                 visibility     = $5,
                 default_branch = $6,
                 web_url        = $7,
                 is_archived    = $8,
                 updated_at     = CURRENT_TIMESTAMP
             WHERE id = $9
             RETURNING *;`,
            [
                resource.name,
                resource.fullName      ?? null,
                resource.description   ?? null,
                resource.ownerName     ?? null,
                resource.visibility,
                resource.defaultBranch ?? null,
                resource.webUrl        ?? null,
                resource.isArchived,
                resource.id
            ]
        );

        if (result.rows.length === 0) {
            throw new Error("Connected resource not found.");
        }
        return this.mapRow(result.rows[0]);
    }

    async archive(id: string): Promise<void> {
        await pool.query(
            `UPDATE connected_resources
             SET is_archived = TRUE, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1;`,
            [id]
        );
    }
}