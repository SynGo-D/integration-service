import { pool } from "../config/database";
import { Integration } from "../models/Integration";

export class IntegrationRepository {
    private mapRow(row: any): Integration {
        return {
            id: row.id,
            userId: row.user_id,
            provider: row.provider,
            accessToken: row.access_token,
            refreshToken: row.refresh_token ?? undefined,
            status: row.status,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    async createIntegration(integration: Integration): Promise<Integration> {
        const query = `
            INSERT INTO integrations (
                id,
                user_id,
                provider,
                access_token,
                refresh_token,
                status,
                created_at,
                updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *;
        `;

        const values = [
            integration.id,
            integration.userId,
            integration.provider,
            integration.accessToken,
            integration.refreshToken ?? null,
            integration.status,
            integration.createdAt ?? new Date(),
            integration.updatedAt ?? new Date(),
        ];

        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async findByUser(userId: string): Promise<Integration[]> {
        const query = `
            SELECT * FROM integrations
            WHERE user_id = $1
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query, [userId]);
        return result.rows.map((row: any) => this.mapRow(row));
    }

    async findById(id: string): Promise<Integration | null> {
        const query = `
            SELECT * FROM integrations
            WHERE id = $1
            LIMIT 1
        `;

        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }

        return this.mapRow(result.rows[0]);
    }

    async updateStatus(id: string, status: Integration["status"]): Promise<Integration> {
        const query = `
            UPDATE integrations
            SET status = $1,
                updated_at = $2
            WHERE id = $3
            RETURNING *;
        `;

        const values = [status, new Date(), id];
        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async deleteIntegration(id: string): Promise<void> {
        const query = `
            DELETE FROM integrations
            WHERE id = $1;
        `;
        await pool.query(query, [id]);
    }
}
