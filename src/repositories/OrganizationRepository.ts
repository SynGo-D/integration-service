import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import type {
    Organization,
    OrganizationMember,
    OrganizationMembership,
    OrganizationRole
} from "../models/Organization.js";

/**
 * The only place SQL for organizations and their members lives
 * (Repository Pattern, as elsewhere in this service).
 */
export class OrganizationRepository {

    /**
     * Creates an organization with its first member as ADMIN, in one
     * transaction: an organization nobody can administer would be
     * unreachable, and there is no way to fix it from the API.
     */
    async createWithOwner(name: string, slug: string, ownerUserId: string): Promise<Organization> {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const id = randomUUID();
            const result = await client.query(
                `INSERT INTO organizations (id, name, slug, created_at, updated_at)
                 VALUES ($1, $2, $3, NOW(), NOW())
                 RETURNING *;`,
                [id, name, slug]
            );

            await client.query(
                `INSERT INTO organization_members (organization_id, user_id, role, created_at, updated_at)
                 VALUES ($1, $2, 'ADMIN', NOW(), NOW());`,
                [id, ownerUserId]
            );

            await client.query("COMMIT");
            return this.mapOrganization(result.rows[0]);

        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async slugExists(slug: string): Promise<boolean> {
        const result = await pool.query(`SELECT 1 FROM organizations WHERE slug = $1 LIMIT 1;`, [slug]);
        return result.rows.length > 0;
    }

    async findById(organizationId: string): Promise<Organization | null> {
        const result = await pool.query(`SELECT * FROM organizations WHERE id = $1 LIMIT 1;`, [organizationId]);
        return result.rows.length > 0 ? this.mapOrganization(result.rows[0]) : null;
    }

    /** Every organization a user belongs to, with their role in each. */
    async findForUser(userId: string): Promise<OrganizationMembership[]> {
        const result = await pool.query(
            `SELECT o.*, m.role
             FROM organizations o
             JOIN organization_members m ON m.organization_id = o.id
             WHERE m.user_id = $1
             ORDER BY o.name;`,
            [userId]
        );

        return result.rows.map((row) => ({
            organization: this.mapOrganization(row),
            role:         row.role as OrganizationRole
        }));
    }

    /** A user's role in one organization, or null when they aren't a member. */
    async roleOf(organizationId: string, userId: string): Promise<OrganizationRole | null> {
        const result = await pool.query(
            `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 LIMIT 1;`,
            [organizationId, userId]
        );
        return result.rows.length > 0 ? (result.rows[0].role as OrganizationRole) : null;
    }

    async members(organizationId: string): Promise<OrganizationMember[]> {
        const result = await pool.query(
            `SELECT u.id, u.email, u.full_name, m.role, m.created_at
             FROM organization_members m
             JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = $1
             ORDER BY m.role, u.email;`,
            [organizationId]
        );

        return result.rows.map((row) => ({
            userId:   row.id,
            email:    row.email,
            fullName: row.full_name,
            role:     row.role as OrganizationRole,
            joinedAt: row.created_at
        }));
    }

    async addMember(organizationId: string, userId: string, role: OrganizationRole): Promise<void> {
        await pool.query(
            `INSERT INTO organization_members (organization_id, user_id, role, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (organization_id, user_id)
             DO UPDATE SET role = EXCLUDED.role, updated_at = NOW();`,
            [organizationId, userId, role]
        );
    }

    async removeMember(organizationId: string, userId: string): Promise<boolean> {
        const result = await pool.query(
            `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2;`,
            [organizationId, userId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * How many admins the organization has. Used before demoting or
     * removing one: an organization with no admin can't be managed again.
     */
    async adminCount(organizationId: string): Promise<number> {
        const result = await pool.query(
            `SELECT count(*)::int AS count FROM organization_members
             WHERE organization_id = $1 AND role = 'ADMIN';`,
            [organizationId]
        );
        return result.rows[0].count;
    }

    private mapOrganization(row: {
        id: string; name: string; slug: string; created_at: Date; updated_at: Date;
    }): Organization {
        return {
            id:        row.id,
            name:      row.name,
            slug:      row.slug,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
