import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import type { Project, ProjectWithRepositories } from "../models/Organization.js";

/**
 * Projects, and which connected repositories are filed under them.
 *
 * A project groups the repositories that make up one product ("Checkout"
 * might be an API and a web app), which is the level a team thinks and
 * reviews at.
 */
export class ProjectRepository {

    async create(organizationId: string, name: string, slug: string, description: string | null): Promise<Project> {
        const result = await pool.query(
            `INSERT INTO projects (id, organization_id, name, slug, description, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING *;`,
            [randomUUID(), organizationId, name, slug, description]
        );
        return this.map(result.rows[0]);
    }

    async slugExists(organizationId: string, slug: string): Promise<boolean> {
        const result = await pool.query(
            `SELECT 1 FROM projects WHERE organization_id = $1 AND slug = $2 LIMIT 1;`,
            [organizationId, slug]
        );
        return result.rows.length > 0;
    }

    async findById(projectId: string): Promise<Project | null> {
        const result = await pool.query(`SELECT * FROM projects WHERE id = $1 LIMIT 1;`, [projectId]);
        return result.rows.length > 0 ? this.map(result.rows[0]) : null;
    }

    /**
     * An organization's projects with their repositories, in one query per
     * side: the project picker shows both, and a project list is small.
     */
    async findForOrganization(organizationId: string): Promise<ProjectWithRepositories[]> {
        const projects = await pool.query(
            `SELECT * FROM projects WHERE organization_id = $1 ORDER BY name;`,
            [organizationId]
        );

        const repositories = await pool.query(
            `SELECT id, project_id, provider, repository_owner, repository_name, status
             FROM integrations
             WHERE organization_id = $1 AND status <> 'REVOKED'
             ORDER BY repository_owner, repository_name;`,
            [organizationId]
        );

        return projects.rows.map((row) => ({
            ...this.map(row),
            repositories: repositories.rows
                .filter((repository) => repository.project_id === row.id)
                .map((repository) => ({
                    integrationId:   repository.id,
                    provider:        repository.provider,
                    repositoryOwner: repository.repository_owner,
                    repositoryName:  repository.repository_name,
                    status:          repository.status
                }))
        }));
    }

    async update(projectId: string, name: string, description: string | null): Promise<Project | null> {
        const result = await pool.query(
            `UPDATE projects SET name = $2, description = $3, updated_at = NOW()
             WHERE id = $1
             RETURNING *;`,
            [projectId, name, description]
        );
        return result.rows.length > 0 ? this.map(result.rows[0]) : null;
    }

    /**
     * Deleting a project unfiles its repositories rather than
     * disconnecting them (ON DELETE SET NULL): the OAuth connection and
     * its webhook are still valid, and analyses already stored stay.
     */
    async delete(projectId: string): Promise<boolean> {
        const result = await pool.query(`DELETE FROM projects WHERE id = $1;`, [projectId]);
        return (result.rowCount ?? 0) > 0;
    }

    /** Files a connected repository under a project (or removes it from one with null). */
    async assignRepository(integrationId: string, organizationId: string, projectId: string | null): Promise<boolean> {
        const result = await pool.query(
            `UPDATE integrations SET project_id = $3, updated_at = NOW()
             WHERE id = $1 AND organization_id = $2;`,
            [integrationId, organizationId, projectId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    private map(row: {
        id: string; organization_id: string; name: string; slug: string;
        description: string | null; created_at: Date; updated_at: Date;
    }): Project {
        return {
            id:             row.id,
            organizationId: row.organization_id,
            name:           row.name,
            slug:           row.slug,
            description:    row.description,
            createdAt:      row.created_at,
            updatedAt:      row.updated_at
        };
    }
}
