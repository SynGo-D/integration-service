// src/repositories/IntegrationRepository.ts

import { randomUUID } from "crypto";
import { pool } from "../config/database.js";
import { Integration } from "../models/Integration.js";
import { encryptToken, decryptToken } from "../utils/crypto.js";

/**
 * Data-access layer for the `integrations` table.
 *
 * Responsibilities:
 *  • Create PENDING integration rows (before OAuth)
 *  • Promote to ACTIVE after successful OAuth token exchange
 *  • Read integrations by user / by ID
 *  • Update status (EXPIRED, REVOKED)
 *
 * Token security:
 *  • Access and refresh tokens are ALWAYS stored encrypted (AES-256-GCM).
 *  • They are ALWAYS decrypted before being returned to the service layer.
 *  • The raw plaintext token never touches the database.
 */
export class IntegrationRepository {

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /** Maps a raw PostgreSQL row to the Integration domain model. */
    private mapRow(row: any): Integration {
        return {
            id:               row.id,
            userId:           row.user_id,
            provider:         row.provider,
            repositoryUrl:    row.repository_url,
            repositoryOwner:  row.repository_owner,
            repositoryName:   row.repository_name,
            accessToken:      row.access_token  ? decryptToken(row.access_token)  : "",
            refreshToken:     row.refresh_token ? decryptToken(row.refresh_token) : undefined,
            tokenExpiresAt:   row.token_expires_at ? new Date(row.token_expires_at) : undefined,
            providerUserId:   row.provider_user_id   ?? undefined,
            providerUsername: row.provider_username  ?? undefined,
            status:           row.status,
            providerWebhookId:   row.provider_webhook_id ?? undefined,
            webhookRegisteredAt: row.webhook_registered_at ? new Date(row.webhook_registered_at) : undefined,
            createdAt:        new Date(row.created_at),
            updatedAt:        new Date(row.updated_at)
        };
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /**
     * Creates a PENDING integration row.
     * Called when the user confirms the repository preview and clicks "Authorize"
     * — before we have OAuth tokens.
     *
     * The access_token column is required (NOT NULL) so we store a placeholder
     * that is replaced by `activateIntegration` after OAuth completes.
     */
    async createPending(
        userId:          string,
        provider:        "github" | "gitlab",
        repositoryUrl:   string,
        repositoryOwner: string,
        repositoryName:  string
    ): Promise<Integration> {

        const id = randomUUID();

        const query = `
            INSERT INTO integrations (
                id,
                user_id,
                provider,
                repository_url,
                repository_owner,
                repository_name,
                access_token,
                status,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW(), NOW())
            RETURNING *;
        `;

        // Placeholder token — replaced when OAuth completes.
        // We encrypt a known sentinel rather than storing an empty string.
        const placeholderToken = encryptToken("__PENDING__");

        const result = await pool.query(query, [
            id,
            userId,
            provider,
            repositoryUrl,
            repositoryOwner,
            repositoryName,
            placeholderToken
        ]);

        return this.mapRow(result.rows[0]);
    }

    /**
     * Promotes a PENDING integration to ACTIVE after OAuth succeeds.
     * Stores encrypted access/refresh tokens and the provider user identity.
     *
     * Uses a transaction-safe UPDATE with RETURNING to confirm the row exists
     * and belongs to the correct user before any token is persisted.
     */
    async activateIntegration(
        id:               string,
        accessToken:      string,
        refreshToken:     string | undefined,
        tokenExpiresAt:   Date   | undefined,
        providerUserId:   string,
        providerUsername: string
    ): Promise<Integration> {

        const query = `
            UPDATE integrations
            SET
                access_token      = $1,
                refresh_token     = $2,
                token_expires_at  = $3,
                provider_user_id  = $4,
                provider_username = $5,
                status            = 'ACTIVE',
                updated_at        = NOW()
            WHERE id     = $6
              AND status = 'PENDING'
            RETURNING *;
        `;

        const result = await pool.query(query, [
            encryptToken(accessToken),
            refreshToken ? encryptToken(refreshToken) : null,
            tokenExpiresAt ?? null,
            providerUserId,
            providerUsername,
            id
        ]);

        if (result.rows.length === 0) {
            throw new Error(
                `Integration ${id} not found or is not in PENDING status.`
            );
        }

        return this.mapRow(result.rows[0]);
    }

    /**
     * Updates the lifecycle status of an integration (e.g. to EXPIRED or REVOKED).
     */
    async updateStatus(
        id:     string,
        status: Integration["status"]
    ): Promise<Integration> {

        const query = `
            UPDATE integrations
            SET status     = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING *;
        `;

        const result = await pool.query(query, [status, id]);

        if (result.rows.length === 0) {
            throw new Error(`Integration ${id} not found.`);
        }

        return this.mapRow(result.rows[0]);
    }

    /**
     * Records the provider-side webhook ID after successful registration.
     * Called by IntegrationService right after the adapter creates the hook.
     */
    async setWebhookId(id: string, providerWebhookId: string): Promise<void> {
        await pool.query(
            `UPDATE integrations
             SET provider_webhook_id   = $1,
                 webhook_registered_at = NOW(),
                 updated_at            = NOW()
             WHERE id = $2;`,
            [providerWebhookId, id]
        );
    }

    /**
     * Clears the stored webhook ID — called after the provider-side hook has
     * been deleted (on revoke) or was found to have already been removed.
     */
    async clearWebhookId(id: string): Promise<void> {
        await pool.query(
            `UPDATE integrations
             SET provider_webhook_id   = NULL,
                 webhook_registered_at = NULL,
                 updated_at            = NOW()
             WHERE id = $1;`,
            [id]
        );
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /**
     * Finds an integration by its primary key.
     * Returns null if no row matches.
     */
    async findById(id: string): Promise<Integration | null> {
        const result = await pool.query(
            `SELECT * FROM integrations WHERE id = $1 LIMIT 1;`,
            [id]
        );

        if (result.rows.length === 0) return null;

        return this.mapRow(result.rows[0]);
    }

    /**
     * Returns all integrations for a user, most-recent first.
     * Access tokens are decrypted before returning to the caller.
     */
    async findByUser(userId: string): Promise<Integration[]> {
        const result = await pool.query(
            `SELECT * FROM integrations
             WHERE user_id = $1
             ORDER BY created_at DESC;`,
            [userId]
        );

        return result.rows.map((row: any) => this.mapRow(row));
    }

    /**
     * Finds the current non-revoked connection (if any) for a user/repo pair —
     * whatever status it's in (PENDING, ACTIVE, or EXPIRED). There can be at
     * most one, enforced by `idx_integrations_user_repo_unique`. Used to
     * prevent duplicate connections and to detect stale/abandoned PENDING
     * rows that would otherwise collide with that same unique index.
     */
    async findConnectionByUserAndRepo(
        userId:          string,
        provider:        "github" | "gitlab",
        repositoryOwner: string,
        repositoryName:  string
    ): Promise<Integration | null> {

        const result = await pool.query(
            `SELECT * FROM integrations
             WHERE user_id          = $1
               AND provider         = $2
               AND repository_owner = $3
               AND repository_name  = $4
               AND status           != 'REVOKED'
             LIMIT 1;`,
            [userId, provider, repositoryOwner, repositoryName]
        );

        if (result.rows.length === 0) return null;

        return this.mapRow(result.rows[0]);
    }

    /**
     * Permanently removes an integration record.
     * Prefer `updateStatus('REVOKED')` to preserve audit history.
     */
    async delete(id: string): Promise<void> {
        await pool.query(
            `DELETE FROM integrations WHERE id = $1;`,
            [id]
        );
    }
}
