// src/repositories/SourceControlConnectionRepository.ts

// PostgreSQL connection pool
import { pool } from "../config/database";

// Domain model
import { SourceControlConnection } from "../models/SourceControlConnection";

/*
    Repository responsible for all database
    operations related to source control connections.

    Responsibilities:
    - Execute SQL queries
    - Map database rows to domain models
    - Never contain business logic
*/
export class SourceControlConnectionRepository {

    /*
        Convert a PostgreSQL row into a
        SourceControlConnection model.
    */
    private mapRow(row: any): SourceControlConnection {
        return {
            id: row.id,
            provider: row.provider,
            providerUserId: row.provider_user_id,
            providerUsername: row.provider_username,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiresAt: row.expires_at,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /*
        Save a new source control connection.
    */
    async create(
        connection: SourceControlConnection
    ): Promise<SourceControlConnection> {

        const query = `
            INSERT INTO source_control_connections (
                id,
                provider,
                provider_user_id,
                provider_username,
                access_token,
                refresh_token,
                expires_at,
                status
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8
            )
            RETURNING *;
        `;

        const result = await pool.query(query, [
            connection.id,
            connection.provider,
            connection.providerUserId,
            connection.providerUsername,
            connection.accessToken,
            connection.refreshToken ?? null,
            connection.expiresAt ?? null,
            connection.status,
        ]);

        return this.mapRow(result.rows[0]);
    }

    /*
        Find a connection by its internal ID.
    */
    async findById(
        id: string
    ): Promise<SourceControlConnection | null> {

        const result = await pool.query(
            `
            SELECT *
            FROM source_control_connections
            WHERE id = $1;
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRow(result.rows[0]);
    }

    /*
        Find a connection using the provider
        and provider user ID.
    */
    async findByProviderUserId(
        provider: "github" | "gitlab",
        providerUserId: string
    ): Promise<SourceControlConnection | null> {

        const result = await pool.query(
            `
            SELECT *
            FROM source_control_connections
            WHERE provider = $1
              AND provider_user_id = $2;
            `,
            [provider, providerUserId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRow(result.rows[0]);
    }

    /*
        Update an existing source control connection.
        Mainly used when refreshing OAuth tokens.
    */
    async update(
        connection: SourceControlConnection
    ): Promise<SourceControlConnection> {

        const result = await pool.query(
            `
            UPDATE source_control_connections
            SET
                access_token = $1,
                refresh_token = $2,
                expires_at = $3,
                status = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *;
            `,
            [
                connection.accessToken,
                connection.refreshToken ?? null,
                connection.expiresAt ?? null,
                connection.status,
                connection.id,
            ]
        );

        return this.mapRow(result.rows[0]);
    }

    /*
        Revoke a connection instead of deleting it.

        Keeping the record allows us to preserve
        audit history and existing repository links.
    */
    async revoke(id: string): Promise<void> {

        await pool.query(
            `
            UPDATE source_control_connections
            SET
                status = 'REVOKED',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1;
            `,
            [id]
        );
    }
}