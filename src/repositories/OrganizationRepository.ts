import { pool } from "../config/database";
import { Organization } from "../models/Organization";

export class OrganizationRepository {
    private mapRow(row: any): Organization {
        return {
            id: row.id,
            integrationId: row.integration_id,
            externalId: row.external_id,
            name: row.name,
            provider: row.provider,
            createdAt: new Date(row.created_at),
        };
    }

    async create(organization: Organization): Promise<Organization> {
        const query = `
            INSERT INTO organizations (
                id,
                integration_id,
                external_id,
                name,
                provider,
                created_at
            ) VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *;
        `;

        const values = [
            organization.id,
            organization.integrationId,
            organization.externalId,
            organization.name,
            organization.provider,
            organization.createdAt ?? new Date(),
        ];

        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async createOrUpdate(organization: Organization): Promise<Organization> {
        const query = `
            INSERT INTO organizations (
                id,
                integration_id,
                external_id,
                name,
                provider,
                created_at
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (integration_id, external_id) DO UPDATE
            SET name = EXCLUDED.name
            RETURNING *;
        `;

        const values = [
            organization.id,
            organization.integrationId,
            organization.externalId,
            organization.name,
            organization.provider,
            organization.createdAt ?? new Date(),
        ];

        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async findByIntegration(integrationId: string): Promise<Organization[]> {
        const query = `
            SELECT * FROM organizations
            WHERE integration_id = $1
            ORDER BY name
        `;
        const result = await pool.query(query, [integrationId]);
        return result.rows.map((row: any) => this.mapRow(row));
    }
}
