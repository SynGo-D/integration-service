// src/repositories/SourceControlConnectionRepository.ts

import { pool } from "../config/database.js";
import { SourceControlConnection } from "../models/SourceControlConnection.js";
import { encryptToken, decryptToken } from "../utils/crypto.js";

/**
 * Data-access layer for the `source_control_connections` table.
 *
 * This table was part of the original schema design and is kept for
 * compatibility. Phase 1 stores connection data on `integrations`.
 * Phase 2+ may migrate to this table for a more unified connection model.
 */
export class SourceControlConnectionRepository {

    private mapRow(row: any): SourceControlConnection {
        return {
            id:               row.id,
            provider:         row.provider,
            providerUserId:   row.provider_user_id,
            providerUsername: row.provider_username,
            accessToken:      row.access_token  ? decryptToken(row.access_token)  : "",
            refreshToken:     row.refresh_token ? decryptToken(row.refresh_token) : undefined,
            expiresAt:        row.expires_at    ? new Date(row.expires_at)        : undefined,
            status:           row.status,
            createdAt:        new Date(row.created_at),
            updatedAt:        new Date(row.updated_at)
        };
    }

    async findById(id: string): Promise<SourceControlConnection | null> {
        const result = await pool.query(
            `SELECT * FROM source_control_connections WHERE id = $1 LIMIT 1;`,
            [id]
        );
        if (result.rows.length === 0) return null;
        return this.mapRow(result.rows[0]);
    }

    async findByUser(userId: string): Promise<SourceControlConnection[]> {
        const result = await pool.query(
            `SELECT * FROM source_control_connections
             WHERE user_id = $1
             ORDER BY created_at DESC;`,
            [userId]
        );
        return result.rows.map((row: any) => this.mapRow(row));
    }
}