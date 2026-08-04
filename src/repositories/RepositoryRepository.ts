import { pool } from "../config/database";
import { Repository } from "../models/Repository";

export class RepositoryRepository {
    private mapRow(row: any): Repository {
        return {
            id: row.id,
            organizationId: row.organization_id,
            externalId: row.external_id,
            name: row.name,
            fullName: row.full_name,
            cloneUrl: row.clone_url ?? undefined,
            defaultBranch: row.default_branch ?? undefined,
            language: row.language ?? undefined,
            visibility: row.visibility ?? undefined,
            lastUpdated: row.last_updated ? new Date(row.last_updated) : undefined,
            createdAt: new Date(row.created_at),
        };
    }

    async create(repository: Repository): Promise<Repository> {
        const query = `
            INSERT INTO repositories (
                id,
                organization_id,
                external_id,
                name,
                full_name,
                clone_url,
                default_branch,
                language,
                visibility,
                last_updated,
                created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING *;
        `;

        const values = [
            repository.id,
            repository.organizationId,
            repository.externalId,
            repository.name,
            repository.fullName,
            repository.cloneUrl ?? null,
            repository.defaultBranch ?? null,
            repository.language ?? null,
            repository.visibility ?? null,
            repository.lastUpdated ?? null,
            repository.createdAt ?? new Date(),
        ];

        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async createOrUpdate(repository: Repository): Promise<Repository> {
        const query = `
            INSERT INTO repositories (
                id,
                organization_id,
                external_id,
                name,
                full_name,
                clone_url,
                default_branch,
                language,
                visibility,
                last_updated,
                created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (organization_id, external_id) DO UPDATE
            SET name = EXCLUDED.name,
                full_name = EXCLUDED.full_name,
                clone_url = EXCLUDED.clone_url,
                default_branch = EXCLUDED.default_branch,
                language = EXCLUDED.language,
                visibility = EXCLUDED.visibility,
                last_updated = EXCLUDED.last_updated
            RETURNING *;
        `;

        const values = [
            repository.id,
            repository.organizationId,
            repository.externalId,
            repository.name,
            repository.fullName,
            repository.cloneUrl ?? null,
            repository.defaultBranch ?? null,
            repository.language ?? null,
            repository.visibility ?? null,
            repository.lastUpdated ?? null,
            repository.createdAt ?? new Date(),
        ];

        const result = await pool.query(query, values);
        return this.mapRow(result.rows[0]);
    }

    async findByOrganization(organizationId: string): Promise<Repository[]> {
        const query = `
            SELECT * FROM repositories
            WHERE organization_id = $1
            ORDER BY name
        `;
        const result = await pool.query(query, [organizationId]);
        return result.rows.map((row: any) => this.mapRow(row));
    }

    async delete(id: string): Promise<void> {
        const query = `
            DELETE FROM repositories
            WHERE id = $1;
        `;
        await pool.query(query, [id]);
    }
}
