/**
 * PostgresTokenStore
 * -----------------------------------------------------------------------------
 * Concrete implementation of ITokenStore backed by the integration_tokens
 * table. Note that this class NEVER encrypts or decrypts — it accepts
 * already-encrypted ciphertext. That's a deliberate separation:
 *
 *   TokenEncryptor  -- crypto
 *   PostgresTokenStore  -- persistence
 *
 * If tomorrow you swap AES-GCM for envelope encryption via KMS, this class
 * doesn't move at all.
 */

import type { ITokenStore, StoredTokenRecord } from "../domain/interfaces/ITokenStore.js";
import { query } from "./db.js";

export class PostgresTokenStore implements ITokenStore {
  async save(record: Omit<StoredTokenRecord, "updatedAt">): Promise<void> {
    await query(
      `INSERT INTO integration_tokens
         (integration_id, platform, ciphertext, refresh_ciphertext, scope, access_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (integration_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext,
             refresh_ciphertext = EXCLUDED.refresh_ciphertext,
             scope = EXCLUDED.scope,
             access_token_expires_at = EXCLUDED.access_token_expires_at,
             updated_at = NOW()`,
      [
        record.integrationId,
        record.platform,
        record.ciphertext,
        record.refreshCiphertext ?? null,
        record.scope,
        record.accessTokenExpiresAt ?? null,
      ],
    );
  }

  async get(integrationId: string): Promise<StoredTokenRecord | null> {
    const res = await query<{
      integration_id: string;
      platform: string;
      ciphertext: string;
      refresh_ciphertext: string | null;
      scope: string;
      access_token_expires_at: Date | null;
      updated_at: Date;
    }>(
      `SELECT integration_id, platform, ciphertext, refresh_ciphertext, scope,
              access_token_expires_at, updated_at
       FROM integration_tokens WHERE integration_id = $1`,
      [integrationId],
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      integrationId: r.integration_id,
      platform: r.platform as StoredTokenRecord["platform"],
      ciphertext: r.ciphertext,
      refreshCiphertext: r.refresh_ciphertext,
      scope: r.scope,
      accessTokenExpiresAt: r.access_token_expires_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async delete(integrationId: string): Promise<void> {
    await query(`DELETE FROM integration_tokens WHERE integration_id = $1`, [integrationId]);
  }
}
